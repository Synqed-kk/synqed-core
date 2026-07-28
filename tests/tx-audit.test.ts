// A1: money actions (booking changes, ticket burns) accept an `audit` payload
// that commits in the SAME transaction as the mutation — a failed mutation
// must leave no trail, a successful one can't lose it.
import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  seedTestAppointment,
  testPrisma,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}
function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

const auditFor = (staffId: string, action: string, requestId: string) => ({
  actor_id: staffId,
  actor_type: 'staff',
  category: 'booking',
  action,
  request_id: requestId,
})

async function auditRows(requestId: string) {
  return testPrisma.auditLog.findMany({
    where: { businessId: TEST_BUSINESS_ID, requestId },
  })
}

afterEach(async () => {
  // audit_log is append-only for the runtime — cleanup via the scrub flag in
  // ONE statement (separate statements can land on different pooled conns).
  await testPrisma.$executeRawUnsafe(
    `DO $$ BEGIN
       PERFORM set_config('app.audit_scrub', 'on', true);
       DELETE FROM audit_log WHERE business_id = '${TEST_BUSINESS_ID}';
     END $$`,
  )
  await cleanupTestData()
})

describe('A1 — transactional mutation+audit', () => {
  it('appointment update commits mutation + audit atomically (both slot and metadata paths)', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const appt = await seedTestAppointment({
      staffId: staff.id,
      customerId: customer.id,
      startsAt: new Date('2026-09-02T01:00:00Z'),
      endsAt: new Date('2026-09-02T02:00:00Z'),
    })

    // Slot-touching path (goes through the advisory-lock transaction).
    const move = await req('PUT', `/appointments/${appt.id}`, {
      starts_at: '2026-09-02T03:00:00.000Z',
      ends_at: '2026-09-02T04:00:00.000Z',
      audit: auditFor(staff.id, 'appointment.reschedule', 'a1-slot'),
    })
    expect(move.status).toBe(200)
    const slotRows = await auditRows('a1-slot')
    expect(slotRows).toHaveLength(1)
    expect(slotRows[0].actorStaffRef).toBe(staff.id)
    expect(slotRows[0].targetId).toBe(appt.id)

    // Metadata-only path.
    const meta = await req('PUT', `/appointments/${appt.id}`, {
      title: '施術内容変更',
      audit: auditFor(staff.id, 'appointment.edit', 'a1-meta'),
    })
    expect(meta.status).toBe(200)
    expect(await auditRows('a1-meta')).toHaveLength(1)
  })

  it('a refused update (overlap 409) writes NO audit row — trail matches truth', async () => {
    const staff = await seedTestStaff()
    const c1 = await seedTestCustomer()
    const c2 = await seedTestCustomer({ email: 'other@ex.com' })
    const blocker = await seedTestAppointment({
      staffId: staff.id,
      customerId: c1.id,
      startsAt: new Date('2026-09-02T01:00:00Z'),
      endsAt: new Date('2026-09-02T02:00:00Z'),
    })
    const mover = await seedTestAppointment({
      staffId: staff.id,
      customerId: c2.id,
      startsAt: new Date('2026-09-02T05:00:00Z'),
      endsAt: new Date('2026-09-02T06:00:00Z'),
    })
    void blocker

    const res = await req('PUT', `/appointments/${mover.id}`, {
      starts_at: '2026-09-02T01:30:00.000Z',
      ends_at: '2026-09-02T02:30:00.000Z',
      audit: auditFor(staff.id, 'appointment.reschedule', 'a1-refused'),
    })
    expect(res.status).toBe(409)
    expect(await auditRows('a1-refused')).toHaveLength(0)
  })

  it('ticket burn + undo carry their audit rows atomically; no-op undo writes none', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const pack = await (
      await req('POST', '/packs', {
        customer_id: customer.id,
        kind: 'テスト回数券',
        pack_size: 10,
        unit_price: 5000,
      })
    ).json()

    const burn = await req('POST', '/packs/redemptions', {
      pack_id: pack.id,
      customer_id: customer.id,
      redeemed_on: '2026-07-28',
      audit: auditFor(staff.id, 'pack.redeem', 'a1-burn'),
    })
    expect(burn.status).toBe(201)
    const { id: redemptionId } = await burn.json()
    const burnRows = await auditRows('a1-burn')
    expect(burnRows).toHaveLength(1)
    expect(burnRows[0].targetId).toBe(redemptionId)

    const undo = await req(
      'DELETE',
      `/packs/redemptions/${redemptionId}?removed_by=${staff.id}`,
      { audit: auditFor(staff.id, 'pack.redeem_undo', 'a1-undo') },
    )
    expect((await undo.json()).ok).toBe(true)
    expect(await auditRows('a1-undo')).toHaveLength(1)

    // Second undo is a no-op — no phantom trail.
    await req('DELETE', `/packs/redemptions/${redemptionId}?removed_by=${staff.id}`, {
      audit: auditFor(staff.id, 'pack.redeem_undo', 'a1-undo-2'),
    })
    expect(await auditRows('a1-undo-2')).toHaveLength(0)
  })

  it('omitted audit keeps legacy behavior: mutation succeeds, zero rows', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const appt = await seedTestAppointment({
      staffId: staff.id,
      customerId: customer.id,
      startsAt: new Date('2026-09-02T01:00:00Z'),
      endsAt: new Date('2026-09-02T02:00:00Z'),
    })
    const res = await req('PUT', `/appointments/${appt.id}`, { title: 'no trail' })
    expect(res.status).toBe(200)
    expect(
      await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID } }),
    ).toBe(0)
  })

  it('malformed audit 400s without mutating', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const appt = await seedTestAppointment({
      staffId: staff.id,
      customerId: customer.id,
      startsAt: new Date('2026-09-02T01:00:00Z'),
      endsAt: new Date('2026-09-02T02:00:00Z'),
    })
    const res = await req('PUT', `/appointments/${appt.id}`, {
      title: 'should not land',
      audit: { category: 'booking' }, // missing actor_type/action
    })
    expect(res.status).toBe(400)
    const row = await testPrisma.appointment.findUnique({ where: { id: appt.id } })
    expect(row?.title).not.toBe('should not land')
  })
})
