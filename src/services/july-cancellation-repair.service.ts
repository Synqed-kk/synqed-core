import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db/client.js'

export const julyCancellationManifest = z.object({
  business_id: z.string().uuid(),
  evidence: z.string().trim().min(1).max(2000),
  appointments: z.array(z.object({
    appointment_id: z.string().uuid(),
    customer_id: z.string().uuid(),
    starts_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    status_reason: z.string().nullable(),
  }).strict()).min(1).max(100),
}).strict().superRefine((manifest, ctx) => {
  if (new Set(manifest.appointments.map(row => row.appointment_id)).size !== manifest.appointments.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate appointment IDs' })
  }
  for (const row of manifest.appointments) {
    const time = Date.parse(row.starts_at)
    if (time < Date.parse('2026-07-09T00:00:00+09:00') || time >= Date.parse('2026-07-11T00:00:00+09:00')) {
      ctx.addIssue({ code: 'custom', message: 'Appointments must fall on July 9–10, 2026 in Japan' })
    }
  }
})

const action = 'correct_july_contacted_cancellation'
const reason = 'cancel-same-day-contact'

/** No HTTP route. Requires an operator's reviewed, exact-record manifest. */
export async function repairJulyCancellations(input: unknown, apply = false) {
  const manifest = julyCancellationManifest.parse(input)
  manifest.appointments.sort((a, b) => a.appointment_id.localeCompare(b.appointment_id))
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM appointments WHERE business_id = ${manifest.business_id}::uuid
        AND id IN (${Prisma.join(manifest.appointments.map(row => Prisma.sql`${row.appointment_id}::uuid`))})
      ORDER BY id FOR UPDATE
    `)
    const changes = []
    let alreadyApplied = 0
    for (const expected of manifest.appointments) {
      const row = await tx.appointment.findFirst({ where: { id: expected.appointment_id, businessId: manifest.business_id } })
      if (!row || row.kind !== 'BOOKING' || row.customerId !== expected.customer_id ||
          row.startsAt.getTime() !== Date.parse(expected.starts_at)) {
        throw new Error(`Repair refused: appointment identity mismatch ${expected.appointment_id}`)
      }
      const prior = await tx.auditLog.findFirst({ where: {
        businessId: manifest.business_id, targetId: row.id, action,
        detail: { path: ['manifest_sha256'], equals: fingerprint },
      } })
      if (prior && row.status === 'CANCELLED' && row.statusReason === reason && row.statusSource === 'STAFF') {
        alreadyApplied++
        continue
      }
      if (row.status !== 'NO_SHOW' || row.statusReason !== expected.status_reason ||
          row.updatedAt.getTime() !== Date.parse(expected.updated_at)) {
        throw new Error(`Repair refused: stale appointment snapshot ${row.id}`)
      }
      changes.push(row)
    }
    const customers = []
    for (const customerId of new Set(changes.map(row => row.customerId!))) {
      const before = await tx.appointment.count({ where: { businessId: manifest.business_id, customerId, status: 'NO_SHOW' } })
      customers.push({ customer_id: customerId, no_show_count_before: before,
        no_show_count_after: before - changes.filter(row => row.customerId === customerId).length })
    }
    if (apply) {
      for (const row of changes) {
        const now = new Date()
        await tx.appointment.update({ where: { id: row.id }, data: {
          status: 'CANCELLED', statusReason: reason, statusSource: 'STAFF', statusSetBy: null,
          statusSetAt: now, cancelledAt: row.cancelledAt ?? now,
          statusEvents: { create: { businessId: manifest.business_id, status: 'CANCELLED', statusSource: 'STAFF', reason } },
        } })
        await tx.auditLog.create({ data: {
          businessId: manifest.business_id, storeId: row.storeId, actorType: 'system',
          category: 'appointment', action, targetType: 'appointment', targetId: row.id,
          detail: { manifest_sha256: fingerprint, evidence: manifest.evidence,
            previous_status: row.status, previous_reason: row.statusReason,
            previous_source: row.statusSource, previous_set_by: row.statusSetBy,
            previous_set_at: row.statusSetAt?.toISOString() ?? null,
            previous_cancelled_at: row.cancelledAt?.toISOString() ?? null,
            previous_updated_at: row.updatedAt.toISOString(), status: 'CANCELLED', reason },
        } })
      }
    }
    return { business_id: manifest.business_id, manifest_sha256: fingerprint,
      proposed: changes.map(row => row.id), already_applied: alreadyApplied,
      changed: apply ? changes.length : 0, customers }
  }, { timeout: 60_000 })
}
