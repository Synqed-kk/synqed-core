import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { repairJulyCancellations } from '../src/services/july-cancellation-repair.service.js'
import { customerEnrichment } from '../src/services/customer-enrichment.service.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, testPrisma, TEST_BUSINESS_ID } from './setup.js'

afterEach(async () => {
  await cleanupTestData()
  await testPrisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL app.audit_scrub = 'on'`
    await tx.auditLog.deleteMany({ where: { businessId: TEST_BUSINESS_ID, action: 'correct_july_contacted_cancellation' } })
  })
})

async function fixture() {
  const customer = await seedTestCustomer()
  const staff = await seedTestStaff()
  const appointment = await testPrisma.appointment.create({ data: {
    businessId: TEST_BUSINESS_ID, customerId: customer.id, staffId: staff.id,
    startsAt: new Date('2026-07-09T03:00:00Z'), endsAt: new Date('2026-07-09T04:00:00Z'),
    status: 'NO_SHOW', statusReason: 'no-show-no-contact', statusSource: 'STAFF',
    cancelledAt: new Date('2026-07-09T03:30:00Z'), title: 'preserved title',
  } })
  const manifest = { business_id: TEST_BUSINESS_ID, evidence: 'confirmed test correction', appointments: [{
    appointment_id: appointment.id, customer_id: customer.id, starts_at: appointment.startsAt.toISOString(),
    updated_at: appointment.updatedAt.toISOString(), status_reason: appointment.statusReason,
  }] }
  return { customer, staff, appointment, manifest }
}

describe('CORE-7 exact July correction', () => {
  it('previews without writes, corrects the derived count and records history/audit once', async () => {
    const { customer, appointment, manifest } = await fixture()
    const preview = await repairJulyCancellations(manifest)
    expect(preview).toMatchObject({ changed: 0, proposed: [appointment.id], customers: [{ customer_id: customer.id, no_show_count_before: 1, no_show_count_after: 0 }] })
    expect(await testPrisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toEqual(appointment)
    expect(await testPrisma.appointmentStatusEvent.count({ where: { appointmentId: appointment.id } })).toBe(0)
    expect((await repairJulyCancellations(manifest, true)).changed).toBe(1)
    const corrected = await testPrisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })
    expect(corrected).toMatchObject({ status: 'CANCELLED', statusReason: 'cancel-same-day-contact', statusSource: 'STAFF', cancelledAt: appointment.cancelledAt, title: appointment.title })
    expect((await customerEnrichment(TEST_BUSINESS_ID)).find(row => row.customer_id === customer.id)?.no_show_count ?? 0).toBe(0)
    expect(await repairJulyCancellations(manifest, true)).toMatchObject({ changed: 0, already_applied: 1 })
    expect(await testPrisma.appointmentStatusEvent.count({ where: { appointmentId: appointment.id, status: 'CANCELLED', reason: 'cancel-same-day-contact' } })).toBe(1)
    const audits = await testPrisma.auditLog.findMany({ where: { targetId: appointment.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0].detail).toMatchObject({ previous_status: 'NO_SHOW', previous_reason: appointment.statusReason, manifest_sha256: preview.manifest_sha256 })
  })

  it('refuses the whole batch when any target is missing, foreign, stale, or outside the confirmed dates', async () => {
    const { appointment, manifest } = await fixture()
    const row = manifest.appointments[0]
    for (const invalid of [
      { ...manifest, appointments: [row, { ...row, appointment_id: randomUUID() }] },
      { ...manifest, business_id: randomUUID() },
      { ...manifest, appointments: [{ ...row, customer_id: randomUUID() }] },
      { ...manifest, appointments: [{ ...row, updated_at: '2026-07-01T00:00:00Z' }] },
      { ...manifest, appointments: [{ ...row, starts_at: '2026-07-08T14:59:59Z' }] },
      { ...manifest, appointments: [row, row] },
    ]) {
      await expect(repairJulyCancellations(invalid, true)).rejects.toThrow()
      expect(await testPrisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toEqual(appointment)
    }
    expect(await testPrisma.auditLog.count({ where: { targetId: appointment.id } })).toBe(0)
  })

  it('serializes simultaneous repair runs without duplicate history or decrements', async () => {
    const { appointment, manifest } = await fixture()
    const reports = await Promise.all([repairJulyCancellations(manifest, true), repairJulyCancellations(manifest, true)])
    expect(reports.map(row => row.changed).sort()).toEqual([0, 1])
    expect(await testPrisma.appointmentStatusEvent.count({ where: { appointmentId: appointment.id } })).toBe(1)
  })

  it('rejects concurrent active burns in the database and permits a replacement after undo', async () => {
    const { customer, appointment } = await fixture()
    const pack = await testPrisma.ticketPack.create({ data: { businessId: TEST_BUSINESS_ID, customerId: customer.id, kind: 'pack', packSize: 10, unitPrice: 8000, status: 'active' } })
    const data = { businessId: TEST_BUSINESS_ID, customerId: customer.id, packId: pack.id, appointmentId: appointment.id, redeemedOn: new Date('2026-07-09') }
    const results = await Promise.allSettled([testPrisma.packRedemption.create({ data }), testPrisma.packRedemption.create({ data })])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(row => row.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('P2002')
    await testPrisma.packRedemption.updateMany({ where: { appointmentId: appointment.id }, data: { removedAt: new Date() } })
    await testPrisma.packRedemption.create({ data })
    expect(await testPrisma.packRedemption.count({ where: { appointmentId: appointment.id, removedAt: null } })).toBe(1)
  })
})
