import { describe, it, expect, afterEach, vi } from 'vitest'
import app from '../src/index.js'
import { SynqedClient } from '../packages/client/src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  testPrisma,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

// CORE-23: the count door, the list's kind/status_not filters, and the
// stable (starts_at, id) order across pages.

process.env.API_KEYS = TEST_API_KEY
const OTHER_BUSINESS_ID = '00000000-0000-0000-0000-0000000000c3'
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID }
const get = (path: string, businessId = TEST_BUSINESS_ID) =>
  app.request(`/v1${path}`, { headers: { ...headers, 'x-business-id': businessId } })

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const businessId of [TEST_BUSINESS_ID, OTHER_BUSINESS_ID]) {
    await testPrisma.appointment.deleteMany({ where: { businessId } })
    await testPrisma.store.deleteMany({ where: { businessId } })
    await testPrisma.staff.deleteMany({ where: { businessId } })
    await testPrisma.customer.deleteMany({ where: { businessId } })
  }
  await cleanupTestData()
})

type Row = {
  startsAt: string
  kind?: 'BOOKING' | 'BLOCK'
  status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
  storeId?: string
  businessId?: string
}

async function seed(rows: Row[]) {
  const byBusiness = new Map<string, { customerId: string; staffId: string }>()
  for (const businessId of new Set(rows.map((r) => r.businessId ?? TEST_BUSINESS_ID))) {
    const customer = await seedTestCustomer({ businessId })
    const staff = await seedTestStaff({ businessId })
    byBusiness.set(businessId, { customerId: customer.id, staffId: staff.id })
  }
  // createMany skips the app's overlap guards — rows may share a slot.
  await testPrisma.appointment.createMany({
    data: rows.map((r) => {
      const businessId = r.businessId ?? TEST_BUSINESS_ID
      const parties = byBusiness.get(businessId)!
      const startsAt = new Date(r.startsAt)
      return {
        businessId,
        kind: r.kind ?? 'BOOKING',
        customerId: r.kind === 'BLOCK' ? null : parties.customerId,
        staffId: parties.staffId,
        storeId: r.storeId ?? null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        status: r.status ?? 'SCHEDULED',
      }
    }),
  })
}

const WINDOW = 'from=2026-09-30T15:00:00Z&to=2026-10-31T15:00:00Z' // JST October

describe('GET /v1/appointments/counts', () => {
  it('buckets by the JST calendar day: 23:30 and 00:30 JST land on different days', async () => {
    await seed([
      { startsAt: '2026-10-05T14:30:00Z' }, // 10-05 23:30 JST
      { startsAt: '2026-10-05T15:30:00Z' }, // 10-06 00:30 JST (still 10-05 in UTC)
    ])
    const res = await get(`/appointments/counts?${WINDOW}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      count: 2,
      by_day: [
        { date: '2026-10-05', count: 1 },
        { date: '2026-10-06', count: 1 },
      ],
    })
  })

  it('counts only customer BOOKINGs that are neither CANCELLED nor NO_SHOW', async () => {
    await seed([
      { startsAt: '2026-10-10T01:00:00Z' },
      { startsAt: '2026-10-10T02:00:00Z', status: 'COMPLETED' },
      { startsAt: '2026-10-10T03:00:00Z', kind: 'BLOCK' }, // customerless hold
      { startsAt: '2026-10-10T04:00:00Z', status: 'CANCELLED' },
      { startsAt: '2026-10-10T05:00:00Z', status: 'NO_SHOW' },
    ])
    const body = await (await get(`/appointments/counts?${WINDOW}`)).json()
    expect(body).toEqual({ count: 2, by_day: [{ date: '2026-10-10', count: 2 }] })
  })

  it("never counts another business's bookings", async () => {
    await seed([
      { startsAt: '2026-10-10T01:00:00Z' },
      { startsAt: '2026-10-10T01:00:00Z', businessId: OTHER_BUSINESS_ID },
      { startsAt: '2026-10-11T01:00:00Z', businessId: OTHER_BUSINESS_ID },
    ])
    const body = await (await get(`/appointments/counts?${WINDOW}`)).json()
    expect(body.count).toBe(1)
    const other = await (await get(`/appointments/counts?${WINDOW}`, OTHER_BUSINESS_ID)).json()
    expect(other.count).toBe(2)
  })

  it('honours store_id and staff_id like the list', async () => {
    const storeA = await testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: 'A' } })
    const storeB = await testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: 'B' } })
    await seed([
      { startsAt: '2026-10-10T01:00:00Z', storeId: storeA.id },
      { startsAt: '2026-10-10T02:00:00Z', storeId: storeA.id },
      { startsAt: '2026-10-10T03:00:00Z', storeId: storeB.id },
    ])
    const a = await (await get(`/appointments/counts?${WINDOW}&store_id=${storeA.id}`)).json()
    expect(a.count).toBe(2)
    const strangerStaff = '00000000-0000-0000-0000-00000000dead'
    const none = await (await get(`/appointments/counts?${WINDOW}&staff_id=${strangerStaff}`)).json()
    expect(none).toEqual({ count: 0, by_day: [] })
  })

  it('a 600-booking window returns the count with no rows, equal to a full row download, bounds included', async () => {
    const rows: Row[] = []
    for (let i = 0; i < 600; i++) {
      rows.push({ startsAt: new Date(Date.UTC(2026, 9, 1) + i * 60 * 60_000).toISOString() })
    }
    rows.push({ startsAt: '2026-09-30T15:00:00Z' }) // exactly from: counted
    rows.push({ startsAt: '2026-10-31T15:00:00Z' }) // exactly to: not counted
    rows.push({ startsAt: '2026-10-12T01:00:00Z', status: 'CANCELLED' })
    rows.push({ startsAt: '2026-10-12T02:00:00Z', kind: 'BLOCK' })
    await seed(rows)

    const res = await get(`/appointments/counts?${WINDOW}`)
    const body = await res.json()
    expect(body.count).toBe(601)
    expect(body).not.toHaveProperty('appointments')
    expect(body.by_day.reduce((n: number, d: { count: number }) => n + d.count, 0)).toBe(601)

    // Same window, same definition, downloaded as rows to exhaustion.
    const listed: string[] = []
    for (let page = 1; ; page++) {
      const r = await (
        await get(`/appointments?${WINDOW}&kind=BOOKING&status_not=CANCELLED&status_not=NO_SHOW&page_size=500&page=${page}`)
      ).json()
      listed.push(...r.appointments.map((a: { id: string }) => a.id))
      expect(r.total).toBe(601)
      if (listed.length >= r.total) break
    }
    expect(listed.length).toBe(body.count)
  })

  it('validates the window: both bounds required, to after from, at most 400 days', async () => {
    expect((await get('/appointments/counts?from=2026-10-01T00:00:00Z')).status).toBe(400)
    expect((await get('/appointments/counts?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z')).status).toBe(400)
    expect((await get('/appointments/counts?from=2026-01-01T00:00:00Z&to=2027-02-06T00:00:00Z')).status).toBe(400)
    expect((await get('/appointments/counts?from=2026-01-01T00:00:00Z&to=2027-02-05T00:00:00Z')).status).toBe(200)
  })
})

describe('GET /v1/appointments list filters and order', () => {
  it('kind and status_not filter rows and total; absent filters change nothing', async () => {
    await seed([
      { startsAt: '2026-10-10T01:00:00Z' },
      { startsAt: '2026-10-10T02:00:00Z', kind: 'BLOCK' },
      { startsAt: '2026-10-10T03:00:00Z', status: 'CANCELLED' },
      { startsAt: '2026-10-10T04:00:00Z', status: 'NO_SHOW' },
    ])
    const all = await (await get(`/appointments?${WINDOW}`)).json()
    expect(all.total).toBe(4)
    const bookings = await (await get(`/appointments?${WINDOW}&kind=BOOKING`)).json()
    expect(bookings.total).toBe(3)
    const blocks = await (await get(`/appointments?${WINDOW}&kind=BLOCK`)).json()
    expect(blocks.appointments.map((a: { kind: string }) => a.kind)).toEqual(['BLOCK'])
    const live = await (await get(`/appointments?${WINDOW}&status_not=CANCELLED&status_not=NO_SHOW`)).json()
    expect(live.total).toBe(2)
    const one = await (await get(`/appointments?${WINDOW}&status_not=CANCELLED`)).json()
    expect(one.total).toBe(3)
    expect((await get(`/appointments?${WINDOW}&kind=NOPE`)).status).toBe(400)
    expect((await get(`/appointments?${WINDOW}&status_not=NOPE`)).status).toBe(400)
  })

  it('bookings at the same starts_at page in id order across a page boundary', async () => {
    const startsAt = new Date('2026-10-10T01:00:00Z')
    for (let i = 0; i < 5; i++) {
      const customer = await seedTestCustomer({ email: `tie${i}@example.com` })
      const staff = await seedTestStaff()
      await testPrisma.appointment.create({
        data: {
          businessId: TEST_BUSINESS_ID,
          customerId: customer.id,
          staffId: staff.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        },
      })
    }
    const ids: string[] = []
    for (let page = 1; page <= 5; page++) {
      const r = await (await get(`/appointments?${WINDOW}&page_size=1&page=${page}`)).json()
      ids.push(r.appointments[0].id)
    }
    expect(ids).toEqual([...ids].sort())
    expect(new Set(ids).size).toBe(5)
  })
})

describe('SDK appointments.counts and list filters', () => {
  it('reach the server and agree on the count', async () => {
    await seed([
      { startsAt: '2026-10-10T01:00:00Z' },
      { startsAt: '2026-10-10T02:00:00Z', kind: 'BLOCK' },
      { startsAt: '2026-10-10T03:00:00Z', status: 'CANCELLED' },
      { startsAt: '2026-10-10T04:00:00Z', status: 'NO_SHOW' },
    ])
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => app.request(url, init))
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
    const window = { from: '2026-09-30T15:00:00Z', to: '2026-10-31T15:00:00Z' }
    const counts = await client.appointments.counts(window)
    expect(counts).toEqual({ count: 1, by_day: [{ date: '2026-10-10', count: 1 }] })
    const list = await client.appointments.list({
      ...window,
      kind: 'BOOKING',
      status_not: ['CANCELLED', 'NO_SHOW'],
      page_size: 1,
    })
    expect(list.total).toBe(counts.count)
  })
})
