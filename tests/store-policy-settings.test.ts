import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index.js'
import { SynqedClient } from '../packages/client/src/index.js'
import { backfillStoreHours, convertOperatingHours } from '../scripts/backfill-store-hours.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const foreignBusiness = randomUUID()
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'Content-Type': 'application/json' }
const req = (method: string, path: string, body?: unknown) => app.request(`/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
async function fixture() {
  const owner = await seedTestStaff({ role: 'OWNER' })
  const store = await testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: 'Settings test' } })
  return { store, owner }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  // Use one transaction so the audit scrub switch is on the deleting connection.
  await testPrisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.audit_scrub', 'on', true)`
    await tx.auditLog.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  })
  await testPrisma.storeBookingPolicy.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.orgSettings.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
  await cleanupTestData()
})

const settings = {
  override_roles: ['店舗管理者'], override_locked_out: [randomUUID()], override_hold_to_confirm: false,
  override_strict_wall: true, min_sellable_min: 0, gap_fill_min_min: 15, held_rank_access: 'gold',
  release_held_roles: [], booking_step_min: 45, block_step_min: 5, gap_fill_discount_pct: 30,
  lead_time_min: 60, reserve_start_grid_min: 15, standard_session_min: 120,
  price_lock_during_recalc: true, breaks_paid: true,
  special_open_days: [{ date: '2026-09-10', open: '10:00', close: '24:00' }], new_client_session_minutes: 240,
} as const

describe('CORE-10 policy settings', () => {
  it('returns named defaults and leaves unspecified scalar defaults unconfigured', async () => {
    const { store } = await fixture()
    const p = await (await req('GET', `/store-policies/${store.id}`)).json()
    expect(p).toMatchObject({ override_roles: ['オーナー','店舗管理者','スタッフ'], override_locked_out: [],
      override_hold_to_confirm: true, override_strict_wall: false, min_sellable_min: 30, gap_fill_min_min: null,
      held_rank_access: 'closed', release_held_roles: ['オーナー','店舗管理者'], booking_step_min: 30, block_step_min: 15,
      gap_fill_discount_pct: null, lead_time_min: null, reserve_start_grid_min: null, standard_session_min: null,
      price_lock_during_recalc: null, breaks_paid: false, special_open_days: [],
    })
    expect(p).not.toHaveProperty('room_policy_vip_stays_private')
    expect(p).not.toHaveProperty('room_policy_private_is_last_resort')
  })

  it('persists every field through SDK and automatically audits each change with authoritative actor and before/after', async () => {
    const { owner, store } = await fixture()
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init))
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
    const data = { ...settings, override_roles: [...settings.override_roles], override_locked_out: [...settings.override_locked_out],
      release_held_roles: [], special_open_days: [...settings.special_open_days], acting_staff_id: owner.id }
    expect(await client.storePolicies.set(store.id, data)).toMatchObject(settings)
    expect(await client.storePolicies.get(store.id)).toMatchObject(settings)
    const firstAudit = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID, action: 'store_policy.edit' } })
    expect(firstAudit).toHaveLength(1)
    expect(firstAudit[0]).toMatchObject({ actorId: owner.id, storeId: store.id, targetId: store.id })
    expect(firstAudit[0].detail).toMatchObject({ changes: expect.arrayContaining([{ field: 'new_client_session_minutes', before: 90, after: 240 }]) })
    await client.storePolicies.set(store.id, { acting_staff_id: owner.id, booking_step_min: 30, gap_fill_min_min: null, special_open_days: [] })
    expect(await client.storePolicies.get(store.id)).toMatchObject({ ...settings, booking_step_min: 30, gap_fill_min_min: null, special_open_days: [] })
    const audit = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID }, orderBy: { at: 'desc' } })
    expect(audit).toHaveLength(2)
    expect(audit[0].detail).toMatchObject({ changes: expect.arrayContaining([{ field: 'booking_step_min', before: 45, after: 30 }]) })
  })

  it('rejects invalid numeric controls, dates, duplicate dates, and unauthorized or foreign-store writes', async () => {
    const { owner, store } = await fixture()
    for (const bad of [{ booking_step_min: 0 }, { block_step_min: -1 }, { booking_step_min: null },
      { block_step_min: 'Infinity' }, { lead_time_min: 1.5 }, { min_sellable_min: -1 }, { gap_fill_discount_pct: 31 },
      { reserve_start_grid_min: 45 }, { new_client_session_minutes: 45.5 }, { new_client_session_minutes: 255 },
      { new_client_session_minutes: 31 }, { held_rank_access: 'vip' },
      { special_open_days: [{ date: '2026-02-30', open: '10:00', close: '20:00' }] },
      { special_open_days: [{ date: '2026-09-10', open: '24:00', close: '24:00' }] },
      { special_open_days: [...settings.special_open_days, ...settings.special_open_days] },
    ]) expect((await req('PUT', `/store-policies/${store.id}`, { acting_staff_id: owner.id, ...bad })).status).toBe(400)
    const staff = await seedTestStaff()
    expect((await req('PUT', `/store-policies/${store.id}`, { acting_staff_id: staff.id, breaks_paid: true })).status).toBe(403)
    const foreign = await testPrisma.store.create({ data: { businessId: foreignBusiness, name: 'Foreign' } })
    expect((await req('PUT', `/store-policies/${foreign.id}`, { acting_staff_id: owner.id, breaks_paid: true })).status).toBe(404)
    expect(await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it('serializes concurrent partial first saves and records accurate before/after for overlapping changes', async () => {
    const { owner, store } = await fixture()
    const responses = await Promise.all([
      req('PUT', `/store-policies/${store.id}`, { acting_staff_id: owner.id, booking_step_min: 45 }),
      req('PUT', `/store-policies/${store.id}`, { acting_staff_id: owner.id, breaks_paid: true }),
    ])
    expect(responses.map(r => r.status)).toEqual([200,200])
    expect(await (await req('GET', `/store-policies/${store.id}`)).json()).toMatchObject({ booking_step_min: 45, breaks_paid: true })
    expect(await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(2)
  })

  it('round-trips and clears store photo_url without altering sibling fields', async () => {
    const { store } = await fixture()
    const photo_url = 'https://images.example.com/store.jpg'
    expect(await (await req('PATCH', `/stores/${store.id}`, { photo_url })).json()).toMatchObject({ photo_url, name: store.name })
    expect(await (await req('GET', `/stores/${store.id}`)).json()).toMatchObject({ photo_url })
    expect(await (await req('PATCH', `/stores/${store.id}`, { photo_url: null })).json()).toMatchObject({ photo_url: null })
  })

  it('previews and idempotently backfills valid org hours, preserves configured stores, and audits applied changes', async () => {
    const { store, owner } = await fixture()
    const other = await testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: 'Configured' } })
    await req('PUT', `/store-policies/${other.id}`, { acting_staff_id: owner.id, weekly_hours: { mon: { open: '09:00', close: '17:00' } } })
    const operating_hours = Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(day => [day, { openMinute: 600, closeMinute: 1440 }]))
    expect(convertOperatingHours({ mon: { openMinute: 600, closeMinute: 1440 } })).toBeNull()
    await testPrisma.orgSettings.create({ data: { businessId: TEST_BUSINESS_ID, settings: { operating_hours } } })
    expect(await backfillStoreHours(false, TEST_BUSINESS_ID)).toEqual(expect.arrayContaining([{ business_id: TEST_BUSINESS_ID, store_id: store.id, status: 'would_update', weekly_hours: expect.objectContaining({ mon: { open: '10:00', close: '24:00' } }) }]))
    expect(await testPrisma.storeBookingPolicy.findUnique({ where: { storeId: store.id } })).toBeNull()
    expect(await backfillStoreHours(true, TEST_BUSINESS_ID)).toEqual(expect.arrayContaining([expect.objectContaining({ store_id: store.id, status: 'updated' }), expect.objectContaining({ store_id: other.id, status: 'configured' })]))
    expect((await backfillStoreHours(true, TEST_BUSINESS_ID)).every(r => r.status === 'configured')).toBe(true)
    expect(await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID, action: 'store_policy.hours_backfill' } })).toBe(1)
    expect(await (await req('GET', `/store-policies/${other.id}`)).json()).toMatchObject({ weekly_hours: { mon: { open: '09:00', close: '17:00' } } })
  })
})
