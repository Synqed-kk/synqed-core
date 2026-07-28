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

  it('actor_label: caller value wins; else resolved from the roster at write time', async () => {
    const staff = await seedTestStaff()
    // No label sent — core snapshots the roster name.
    const auto = await (
      await req('POST', '/audit', {
        actor_id: staff.id,
        actor_type: 'staff',
        category: 'customer',
        action: 'customer.edit',
      })
    ).json()
    expect(auto.actor_label).toBe(staff.name)
    // Caller label wins over the roster.
    const explicit = await (
      await req('POST', '/audit', {
        actor_id: staff.id,
        actor_type: 'staff',
        actor_label: '明示ラベル',
        category: 'customer',
        action: 'customer.edit',
      })
    ).json()
    expect(explicit.actor_label).toBe('明示ラベル')
  })

  it('severity / exclude_views / store_id filters', async () => {
    const A = '11111111-1111-1111-1111-111111111111'
    await req('POST', '/audit', { actor_type: 'staff', category: 'customer', action: 'customer.view', severity: 'info', store_id: A })
    await req('POST', '/audit', { actor_type: 'staff', category: 'customer', action: 'customer.edit', severity: 'warn', store_id: A })
    await req('POST', '/audit', { actor_type: 'staff', category: 'auth', action: 'auth.pin_lockout', severity: 'critical' })
    // Historical app spelling (pre-7/27 privacy.audit_log_view rows) — the
    // '_view' suffix must be excluded exactly like '.view' or the app feed's
    // total/hasMore drift on rows its client belt hides.
    await req('POST', '/audit', { actor_type: 'staff', category: 'privacy', action: 'privacy.audit_log_view', severity: 'info' })

    const warns = await (await req('GET', '/audit?severity=warn')).json()
    expect(warns.total).toBe(1)
    expect(warns.events[0].action).toBe('customer.edit')

    // "Everything except views" — the summary strip's 変更/警告 counts.
    const noViews = await (await req('GET', '/audit?exclude_views=true')).json()
    expect(noViews.total).toBe(2)
    expect(
      noViews.events.every(
        (e: { action: string }) => !e.action.endsWith('.view') && !e.action.endsWith('_view'),
      ),
    ).toBe(true)

    const storeA = await (await req('GET', `/audit?store_id=${A}`)).json()
    expect(storeA.total).toBe(2)
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

describe('audit_log — actor_staff_ref + request_id (A3/A4)', () => {
  it('stamps the staff CARD id from either identity form of actor_id', async () => {
    const staff = await seedTestStaff({ userId: '99999999-0000-0000-0000-000000000009' })

    // card id form
    const byCard = await (
      await req('POST', '/audit', {
        actor_id: staff.id,
        actor_type: 'staff',
        category: 'customer',
        action: 'edit',
      })
    ).json()
    expect(byCard.actor_staff_ref).toBe(staff.id)

    // login uuid form — still stored under the card
    const byLogin = await (
      await req('POST', '/audit', {
        actor_id: '99999999-0000-0000-0000-000000000009',
        actor_type: 'staff',
        category: 'customer',
        action: 'edit',
      })
    ).json()
    expect(byLogin.actor_staff_ref).toBe(staff.id)
  })

  it('caller-supplied actor_staff_ref wins; unresolvable actor_id stays null', async () => {
    const staff = await seedTestStaff()
    const explicit = await (
      await req('POST', '/audit', {
        actor_id: '99999999-0000-0000-0000-000000000001', // no roster match
        actor_staff_ref: staff.id,
        actor_type: 'staff',
        category: 'customer',
        action: 'edit',
      })
    ).json()
    expect(explicit.actor_staff_ref).toBe(staff.id)

    const orphan = await (
      await req('POST', '/audit', {
        actor_id: '99999999-0000-0000-0000-000000000001',
        actor_type: 'system',
        category: 'sync',
        action: 'run',
      })
    ).json()
    expect(orphan.actor_staff_ref).toBeNull()
  })

  it('actor_staff_ref + request_id filter the list; request_id round-trips', async () => {
    const s1 = await seedTestStaff()
    const s2 = await seedTestStaff({ name: '別スタッフ' })
    await req('POST', '/audit', {
      actor_id: s1.id, actor_type: 'staff', category: 'customer', action: 'edit',
      request_id: 'req-corr-1',
    })
    await req('POST', '/audit', {
      actor_id: s1.id, actor_type: 'staff', category: 'karute', action: 'view',
      request_id: 'req-corr-1',
    })
    await req('POST', '/audit', {
      actor_id: s2.id, actor_type: 'staff', category: 'customer', action: 'edit',
    })

    const byStaff = await (await req('GET', `/audit?actor_staff_ref=${s1.id}`)).json()
    expect(byStaff.total).toBe(2)
    expect(byStaff.events.every((e: { actor_staff_ref: string }) => e.actor_staff_ref === s1.id)).toBe(true)

    const byReq = await (await req('GET', '/audit?request_id=req-corr-1')).json()
    expect(byReq.total).toBe(2)
    expect(byReq.events.every((e: { request_id: string }) => e.request_id === 'req-corr-1')).toBe(true)
  })

  it('boolean query params: explicit false means false (regression for coerce)', async () => {
    const staff = await seedTestStaff()
    await req('POST', '/audit', {
      actor_id: staff.id, actor_type: 'staff', category: 'karute', action: 'record.view',
    })
    await req('POST', '/audit', {
      actor_id: staff.id, actor_type: 'staff', category: 'customer', action: 'edit',
    })

    const excluded = await (await req('GET', '/audit?exclude_views=true')).json()
    expect(excluded.total).toBe(1)
    // false must include views — z.coerce.boolean() turned "false" into true.
    const included = await (await req('GET', '/audit?exclude_views=false')).json()
    expect(included.total).toBe(2)

    const bogus = await req('GET', '/audit?exclude_views=maybe')
    expect(bogus.status).toBe(400)
  })
})
