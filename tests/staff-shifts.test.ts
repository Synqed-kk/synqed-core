import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/supabase-auth.service.js', () => ({
  verifySupabaseAccessToken: vi.fn(async (token: string) => token),
}))
import app from '../src/index.js'
import { SynqedClient } from '../packages/client/src/index.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const ownerUser = randomUUID()
const staffUser = randomUUID()
const otherBusiness = randomUUID()
let staffId: string
let ownerId: string
let storeId: string

function req(method: string, path: string, body?: unknown, user: string | null = ownerUser, businessId = TEST_BUSINESS_ID) {
  return app.request(`/v1/staff-shifts${path}`, {
    method,
    headers: { 'x-api-key': TEST_API_KEY, 'x-business-id': businessId, 'Content-Type': 'application/json',
      ...(user ? { Authorization: `Bearer ${user}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function input(overrides: Record<string, unknown> = {}) {
  return { staff_id: staffId, store_id: storeId, date: '2026-09-07', start: 540, end: 1080, ...overrides }
}
async function clean() {
  vi.unstubAllGlobals()
  await testPrisma.staffShift.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, otherBusiness] } } })
  await testPrisma.staffPermission.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
  await testPrisma.staff.deleteMany({ where: { businessId: otherBusiness } })
  await testPrisma.store.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, otherBusiness] } } })
}
beforeEach(async () => {
  await clean()
  ownerId = (await seedTestStaff({ userId: ownerUser, role: 'OWNER' })).id
  staffId = (await seedTestStaff({ userId: staffUser })).id
  storeId = (await testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: 'Shift store' } })).id
})
afterEach(clean)

describe('staff shift API', () => {
  it('exposes the complete authenticated CRUD and filter contract through the SDK', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init))
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY,
      businessId: TEST_BUSINESS_ID, accessToken: ownerUser })
    const row = await client.staffShifts.create({ staff_id: staffId, store_id: storeId, date: '2026-09-07', start: 540, end: 1080 })
    expect(await client.staffShifts.get(row.id)).toEqual(row)
    expect(await client.staffShifts.list({ store_id: storeId, date: '2026-09-07' })).toMatchObject({ shifts: [row], total: 1 })
    expect(await client.staffShifts.update(row.id, { end: 1100 })).toMatchObject({ end: 1100 })
    await client.staffShifts.delete(row.id)
    expect(await client.staffShifts.list()).toMatchObject({ total: 0 })
  })

  it('round-trips a dated working window, breaks and blocks, then updates and deletes it', async () => {
    const response = await req('POST', '', input({ breaks: [{ start: 720, end: 750 }], blocks: [{ start: 900, end: 930 }] }))
    expect(response.status).toBe(201)
    const row = await response.json()
    expect(row).toMatchObject({ ...input(), created_by: ownerId, updated_by: ownerId,
      breaks: [{ start: 720, end: 750 }], blocks: [{ start: 900, end: 930 }] })
    expect(await (await req('GET', `/${row.id}`)).json()).toEqual(row)
    const changed = await req('PUT', `/${row.id}`, { end: 1440, breaks: [] })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ date: '2026-09-07', start: 540, end: 1440, breaks: [], blocks: row.blocks })
    expect((await req('DELETE', `/${row.id}`)).status).toBe(200)
    expect((await req('GET', `/${row.id}`)).status).toBe(404)
    expect((await req('DELETE', `/${row.id}`)).status).toBe(404)
  })

  it('requires a verified staff manager and enforces the manager store scope', async () => {
    expect((await req('POST', '', input(), null)).status).toBe(401)
    expect((await req('POST', '', input(), staffUser)).status).toBe(403)
    await testPrisma.staffPermission.create({ data: {
      businessId: TEST_BUSINESS_ID, staffId, role: 'area_manager', assignedStoreIds: [],
    } })
    expect((await req('POST', '', input(), staffUser)).status).toBe(403)
    await testPrisma.staffPermission.update({ where: { staffId }, data: { assignedStoreIds: [storeId] } })
    const response = await req('POST', '', input(), staffUser)
    expect(response.status).toBe(201)
    const row = await response.json()
    await testPrisma.staffPermission.update({ where: { staffId }, data: { assignedStoreIds: [] } })
    expect((await req('PUT', `/${row.id}`, { end: 1100 }, staffUser)).status).toBe(403)
    expect((await req('DELETE', `/${row.id}`, undefined, staffUser)).status).toBe(403)
  })

  it('rejects cross-business subjects and isolates reads and mutations by business', async () => {
    const foreign = await testPrisma.staff.create({ data: { businessId: otherBusiness, name: 'Foreign' } })
    const foreignStore = await testPrisma.store.create({ data: { businessId: otherBusiness, name: 'Foreign' } })
    expect((await req('POST', '', input({ staff_id: foreign.id }))).status).toBe(400)
    expect((await req('POST', '', input({ store_id: foreignStore.id }))).status).toBe(400)
    const row = await (await req('POST', '', input())).json()
    expect((await req('GET', `/${row.id}`, undefined, null, otherBusiness)).status).toBe(404)
    expect(await (await req('GET', '', undefined, null, otherBusiness)).json()).toMatchObject({ total: 0, shifts: [] })
    expect((await req('PUT', `/${row.id}`, { end: 1100 }, ownerUser, otherBusiness)).status).toBe(403)
    expect((await req('DELETE', `/${row.id}`, undefined, ownerUser, otherBusiness)).status).toBe(403)
  })

  it('rejects invalid dates/windows and validates partial updates against retained intervals', async () => {
    for (const invalid of [
      { date: '2026-02-30' }, { date: 'not-a-date' }, { start: -1 }, { start: 10.5 }, { end: 1441 },
      { start: 1080 }, { breaks: [{ start: 500, end: 600 }] },
      { breaks: [{ start: 700, end: 800 }], blocks: [{ start: 750, end: 850 }] },
    ]) expect((await req('POST', '', input(invalid))).status).toBe(400)
    const row = await (await req('POST', '', input({ breaks: [{ start: 600, end: 630 }] }))).json()
    expect((await req('PUT', `/${row.id}`, { start: 660 })).status).toBe(400)
    expect((await req('PUT', `/${row.id}`, { date: '2026-09-08' })).status).toBe(400)
    expect((await req('PUT', `/${row.id}`, { breaks: null })).status).toBe(400)
    expect((await req('GET', '/malformed')).status).toBe(400)
    expect((await req('GET', '?from=2026-09-09&to=2026-09-08')).status).toBe(400)
    expect(await (await req('GET', `/${row.id}`)).json()).toMatchObject({ start: 540, breaks: [{ start: 600, end: 630 }] })
  })

  it('allows one duplicate create and prevents two partial edits from invalidating each other', async () => {
    const duplicates = await Promise.all([req('POST', '', input()), req('POST', '', input())])
    expect(duplicates.map(r => r.status).sort()).toEqual([201, 409])
    const row = await duplicates.find(r => r.status === 201)!.json()
    const edits = await Promise.all([
      req('PUT', `/${row.id}`, { start: 660 }),
      req('PUT', `/${row.id}`, { breaks: [{ start: 600, end: 630 }] }),
    ])
    expect(edits.map(r => r.status).sort()).toEqual([200, 400])
    const stored = await (await req('GET', `/${row.id}`)).json()
    if (stored.start === 660) expect(stored.breaks).toEqual([])
    else expect(stored).toMatchObject({ start: 540, breaks: [{ start: 600, end: 630 }] })
  })

  it('returns stable paged day/store/staff reads with an exclusive upper date', async () => {
    for (const date of ['2026-09-07', '2026-09-08', '2026-09-09']) {
      expect((await req('POST', '', input({ date }))).status).toBe(201)
    }
    const filter = `?store_id=${storeId}&staff_id=${staffId}&from=2026-09-07&to=2026-09-09&page_size=1`
    const first = await (await req('GET', filter)).json()
    const second = await (await req('GET', `${filter}&page=2`)).json()
    expect(first).toMatchObject({ total: 2, page: 1, page_size: 1 })
    expect(first.shifts[0].date).toBe('2026-09-07')
    expect(second.shifts[0].date).toBe('2026-09-08')
    const day = await (await req('GET', '?date=2026-09-09')).json()
    expect(day.total).toBe(1)
    expect(day.shifts[0].date).toBe('2026-09-09')
  })
})
