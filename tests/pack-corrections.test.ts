import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index.js'
import { SynqedClient } from '../packages/client/src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const otherBusiness = randomUUID()
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'Content-Type': 'application/json' }
const req = (method: string, path: string, body?: unknown, key?: string, business = TEST_BUSINESS_ID) => app.request(`/v1${path}`, {
  method, headers: { ...headers, 'x-business-id': business, ...(key ? { 'Idempotency-Key': key } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
async function fixture() {
  const customer = await seedTestCustomer()
  const staff = await seedTestStaff()
  const input = { customer_id: customer.id, kind: 'pack', pack_size: 10, unit_price: 8000 }
  const pack = await (await req('POST', '/packs', input)).json()
  const burn = { pack_id: pack.id, customer_id: customer.id, redeemed_on: '2026-09-07' }
  return { customer, staff, pack, input, burn }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await testPrisma.idempotencyKey.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, otherBusiness] } } })
  await testPrisma.ticketPack.deleteMany({ where: { businessId: otherBusiness } })
  await testPrisma.staff.deleteMany({ where: { businessId: otherBusiness } })
  await cleanupTestData()
})

describe('pack corrections', () => {
  it('preserves all legacy burn sources and requires a reason and same-business active actor for correction/recovery', async () => {
    const { burn, staff } = await fixture()
    for (const source of ['manual', 'auto', 'import', 'qr', 'pos', 'backfill']) {
      expect((await req('POST', '/packs/redemptions', { ...burn, source })).status).toBe(201)
    }
    const foreign = await seedTestStaff({ businessId: otherBusiness })
    for (const source of ['recovery', 'correction']) {
      for (const extra of [{}, { reason: 'fix' }, { created_by: staff.id }, { reason: ' ', created_by: staff.id }, { reason: 'fix', created_by: foreign.id }]) {
        expect((await req('POST', '/packs/redemptions', { ...burn, source, ...extra })).status).toBe(400)
      }
      expect((await req('POST', '/packs/redemptions', { ...burn, source, reason: 'Missed burn', created_by: staff.id })).status).toBe(201)
    }
    expect((await req('POST', '/packs/redemptions', { ...burn, source: 'unknown' })).status).toBe(400)
    await testPrisma.staff.update({ where: { id: staff.id }, data: { isActive: false } })
    expect((await req('POST', '/packs/redemptions', { ...burn, source: 'correction', reason: 'fix', created_by: staff.id })).status).toBe(400)
  })

  it('retains addition and removal trails through the SDK while default reads exclude removed rows', async () => {
    const { burn, staff } = await fixture()
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init))
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
    const added = await client.packs.addRedemption({ ...burn, source: 'correction', reason: 'Wrong date & staff', created_by: staff.id, counts_as_visit: false })
    expect((await req('DELETE', `/packs/redemptions/${added.id}`)).status).toBe(400)
    expect((await req('DELETE', `/packs/redemptions/${added.id}?source=manual`)).status).toBe(400)
    expect(await client.packs.removeRedemption(added.id, { source: 'correction', reason: 'Undo & retain history', removed_by: staff.id })).toEqual({ ok: true })
    expect(await client.packs.listRecentRedemptions('2026-09-01')).toEqual([])
    expect(await client.packs.listRecentRedemptions('2026-09-01', { include_removed: true })).toEqual([expect.objectContaining({
      id: added.id, source: 'correction', reason: 'Wrong date & staff', created_by: staff.id,
      counts_as_visit: false, removed_at: expect.any(String), removed_by: staff.id,
      removal_source: 'correction', removal_reason: 'Undo & retain history',
    })])
    expect(await client.packs.removeRedemption(added.id)).toEqual({ ok: false })
  })

  it('supports correction removal of a legacy burn and leaves its original source intact', async () => {
    const { burn, staff } = await fixture()
    const added = await (await req('POST', '/packs/redemptions', { ...burn, source: 'auto' })).json()
    expect((await req('DELETE', `/packs/redemptions/${added.id}?source=correction&reason=mistap`)).status).toBe(400)
    expect((await req('DELETE', `/packs/redemptions/${added.id}?source=correction&reason=mistap&removed_by=${staff.id}`)).status).toBe(200)
    expect(await testPrisma.packRedemption.findUnique({ where: { id: added.id } })).toMatchObject({ source: 'auto', removalSource: 'correction', removalReason: 'mistap', removedBy: staff.id })
  })

  it('adds void without deleting pack or burn history and preserves all existing statuses', async () => {
    const { pack, burn, customer } = await fixture()
    await req('POST', '/packs/redemptions', burn)
    for (const status of ['exhausted', 'cancelled', 'active', 'void']) {
      expect(await (await req('PATCH', `/packs/${pack.id}/status`, { status })).json()).toEqual({ ok: true })
    }
    expect(await (await req('GET', '/packs/active')).json()).toEqual({ packs: [] })
    expect(await (await req('GET', `/packs?customer_id=${customer.id}`)).json()).toMatchObject({ packs: [{ id: pack.id, status: 'void' }] })
    expect(await testPrisma.packRedemption.count({ where: { packId: pack.id } })).toBe(1)
    expect((await req('PATCH', `/packs/${pack.id}/status`, { status: 'typo' })).status).toBe(400)
    expect(await (await req('PATCH', `/packs/${pack.id}/status`, { status: 'active' }, undefined, otherBusiness)).json()).toEqual({ ok: false })
  })

  it('returns the complete recent set beyond 1000 rows and only exposes removed history on opt-in', async () => {
    const { pack, customer } = await fixture()
    await testPrisma.packRedemption.createMany({ data: Array.from({ length: 1001 }, () => ({
      businessId: TEST_BUSINESS_ID, packId: pack.id, customerId: customer.id, redeemedOn: new Date('2026-09-07'),
    })) })
    const result = await (await req('GET', '/packs/redemptions/recent?since=2026-09-07')).json()
    expect(result.redemptions).toHaveLength(1001)
    expect((await req('GET', '/packs/redemptions/recent?since=2026-02-30')).status).toBe(400)
    expect(await (await req('GET', '/packs/redemptions/recent?since=2026-09-01&include_removed=true', undefined, undefined, otherBusiness)).json()).toEqual({ redemptions: [] })
  })

  it('creates one pack for concurrent and retried keys, replays a full pack through SDK, and scopes keys by business and operation', async () => {
    const { input, burn } = await fixture()
    const key = randomUUID()
    const results = await Promise.all(Array.from({ length: 4 }, () => req('POST', '/packs', input, key)))
    expect(results.map(r => r.status).sort()).toEqual([200, 200, 200, 201])
    const rows = await Promise.all(results.map(r => r.json()))
    expect(new Set(rows.map(r => r.id)).size).toBe(1)
    expect(await testPrisma.ticketPack.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(2)
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init))
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
    expect(await client.packs.createPack(input, { idempotencyKey: key })).toEqual(rows[0])
    expect((await req('POST', '/packs/redemptions', burn, key)).status).toBe(201)
    expect((await req('POST', '/packs', input, key, otherBusiness)).status).toBe(201)
  })

  it('rolls back a creation failure with its idempotency key so retry can succeed', async () => {
    const { input } = await fixture()
    const key = randomUUID()
    // PostgreSQL integer overflow occurs after the claim insert, inside the tx.
    expect((await req('POST', '/packs', { ...input, pack_size: 2147483648 }, key)).status).toBe(500)
    expect(await testPrisma.idempotencyKey.count({ where: { businessId: TEST_BUSINESS_ID, key } })).toBe(0)
    expect((await req('POST', '/packs', input, key)).status).toBe(201)
  })

  it('ignores malformed customer IDs without widening an all-invalid batch into the full customer list', async () => {
    const { customer } = await fixture()
    expect(await (await req('GET', `/customers?ids=bad,${customer.id},also-bad`)).json()).toMatchObject({ customers: [{ id: customer.id }], total: 1 })
    expect(await (await req('GET', '/customers?ids=bad,also-bad')).json()).toMatchObject({ customers: [], total: 0 })
    expect(await (await req('GET', '/customers?ids=')).json()).toMatchObject({ customers: [{ id: customer.id }], total: 1 })
  })
})
