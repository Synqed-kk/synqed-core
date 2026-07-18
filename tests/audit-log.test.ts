// audit_log wave 1: one write path, DB-enforced append-only, break_glass
// filter, detail cap, customer soft-delete + restore + hard-delete scrub,
// removeRedemption records WHO.
import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
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

afterEach(async () => {
  // audit_log is append-only for the runtime — cleanup goes through a single
  // scrub-flagged DO block. ONE statement = one pooled connection; separate
  // statements can land on different connections and the flag won't be set
  // where the DELETE runs.
  await testPrisma.$executeRawUnsafe(
    `DO $$ BEGIN
       PERFORM set_config('app.audit_scrub', 'on', true);
       DELETE FROM audit_log WHERE business_id = '${TEST_BUSINESS_ID}';
     END $$`,
  )
  await cleanupTestData()
})

describe('audit_log', () => {
  it('logs + lists an event; break_glass is one-query filterable', async () => {
    const staff = await seedTestStaff()
    const res = await req('POST', '/audit', {
      actor_id: staff.id,
      actor_type: 'staff',
      actor_role: 'STYLIST',
      category: 'customer',
      action: 'view',
      target_type: 'customer',
      target_id: '11111111-1111-1111-1111-111111111111',
      target_label: 'テスト太郎',
      detail: { screen: 'customer-profile' },
    })
    expect(res.status).toBe(201)

    await req('POST', '/audit', {
      actor_type: 'dev',
      category: 'customer',
      action: 'view',
      break_glass: true,
      severity: 'warn',
    })

    const all = await (await req('GET', '/audit')).json()
    expect(all.total).toBe(2)
    const bg = await (await req('GET', '/audit?break_glass=true')).json()
    expect(bg.total).toBe(1)
    expect(bg.events[0].actor_type).toBe('dev')
  })

  it('append-only is enforced IN THE DB: raw UPDATE and DELETE both raise', async () => {
    await req('POST', '/audit', { actor_type: 'system', category: 'test', action: 'x' })
    await expect(
      testPrisma.$executeRawUnsafe(
        `UPDATE audit_log SET action = 'tampered' WHERE business_id = '${TEST_BUSINESS_ID}'`,
      ),
    ).rejects.toThrow(/append-only/)
    await expect(
      testPrisma.$executeRawUnsafe(
        `DELETE FROM audit_log WHERE business_id = '${TEST_BUSINESS_ID}'`,
      ),
    ).rejects.toThrow(/append-only/)
  })

  it('caps oversized detail at ~2KB with a truncation marker', async () => {
    const res = await req('POST', '/audit', {
      actor_type: 'system',
      category: 'test',
      action: 'big',
      detail: { blob: 'x'.repeat(10_000) },
    })
    const event = await res.json()
    expect(event.detail.truncated).toBe(true)
  })
})

describe('customer soft delete (30-day window)', () => {
  it('update({deleted_at}) hides from list; include_deleted + restore bring it back', async () => {
    const c1 = await seedTestCustomer({ name: '削除対象', email: 'del@ex.com' })
    await seedTestCustomer({ name: '残留', email: 'stay@ex.com' })

    const del = await req('PUT', `/customers/${c1.id}`, {
      deleted_at: new Date().toISOString(),
    })
    expect(del.status).toBe(200)

    const list = await (await req('GET', '/customers')).json()
    expect(list.customers.map((c: { name: string }) => c.name)).toEqual(['残留'])

    const bin = await (await req('GET', '/customers?include_deleted=true')).json()
    expect(bin.total).toBe(2)

    const restore = await req('PUT', `/customers/${c1.id}`, { deleted_at: null })
    expect((await restore.json()).deleted_at).toBeNull()
    const after = await (await req('GET', '/customers')).json()
    expect(after.total).toBe(2)
  })

  it('hard delete cascades appointments core-side and scrubs audit rows', async () => {
    const c1 = await seedTestCustomer({ name: '完全削除', email: 'hard@ex.com' })
    const staff = await seedTestStaff()
    await testPrisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        customerId: c1.id,
        staffId: staff.id,
        startsAt: new Date('2026-11-01T01:00:00Z'),
        endsAt: new Date('2026-11-01T02:00:00Z'),
        status: 'SCHEDULED',
        source: 'MANUAL',
      },
    })
    await req('POST', '/audit', {
      actor_type: 'staff',
      category: 'customer',
      action: 'view',
      target_type: 'customer',
      target_id: c1.id,
      target_label: '完全削除',
      detail: { screen: 'profile' },
    })

    const res = await req('DELETE', `/customers/${c1.id}`)
    expect(res.status).toBe(200)

    // Appointment gone without the app pre-deleting (core owns the cascade)
    expect(
      await testPrisma.appointment.count({ where: { customerId: c1.id } }),
    ).toBe(0)

    // Audit row survives but scrubbed: hashed target, no label/detail
    const rows = await testPrisma.$queryRawUnsafe<
      Array<{ target_id: string; target_label: string | null; detail: unknown }>
    >(
      `SELECT target_id, target_label, detail FROM audit_log WHERE business_id = '${TEST_BUSINESS_ID}' AND target_type = 'customer'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].target_id).not.toBe(c1.id)
    expect(rows[0].target_id).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0].target_label).toBeNull()
    expect(rows[0].detail).toBeNull()
  })
})

describe('removeRedemption records WHO', () => {
  it('soft-deletes with removed_by; removed rows leave reads', async () => {
    const c1 = await seedTestCustomer({ name: '回数券', email: 'pack@ex.com' })
    const staff = await seedTestStaff()
    const pack = await testPrisma.ticketPack.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        customerId: c1.id,
        kind: 'STANDARD',
        packSize: 10,
        unitPrice: 5000,
        status: 'active',
      },
    })
    const redemption = await testPrisma.packRedemption.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        packId: pack.id,
        customerId: c1.id,
        redeemedOn: new Date('2026-11-01'),
      },
    })

    const res = await req(
      'DELETE',
      `/packs/redemptions/${redemption.id}?removed_by=${staff.id}`,
    )
    expect((await res.json()).ok).toBe(true)

    const row = await testPrisma.packRedemption.findUnique({ where: { id: redemption.id } })
    expect(row?.removedAt).not.toBeNull()
    expect(row?.removedBy).toBe(staff.id)
  })
})
