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

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

afterEach(async () => {
  await cleanupTestData()
})

describe('multi-store store_id', () => {
  it('persists store_id on upserted visits', async () => {
    const c = await seedTestCustomer()
    const res = await req('PUT', `/customers/${c.id}/visits`, {
      visits: [{ qr_reservation_id: 5005, used_at: '2026-05-01T01:00:00Z', status: 'settled', store_id: A }],
    })
    expect(res.status).toBe(200)
    const row = await testPrisma.customerVisit.findFirst({ where: { qrReservationId: 5005 } })
    expect(row?.storeId).toBe(A)
  })

  it('accepts + returns store_id on an appointment', async () => {
    const c = await seedTestCustomer()
    const s = await seedTestStaff()
    const res = await req('POST', '/appointments', {
      customer_id: c.id, staff_id: s.id, store_id: A,
      starts_at: '2026-07-01T02:00:00Z', ends_at: '2026-07-01T03:00:00Z',
    })
    expect(res.status).toBe(201)
    expect((await res.json()).store_id).toBe(A)
  })

  it('overlap guard is per-store: same staff+time in a different store does not conflict', async () => {
    const c = await seedTestCustomer()
    const s = await seedTestStaff()
    const body = (store: string) => ({
      customer_id: c.id, staff_id: s.id, store_id: store,
      starts_at: '2026-07-02T02:00:00Z', ends_at: '2026-07-02T03:00:00Z',
    })
    expect((await req('POST', '/appointments', body(A))).status).toBe(201)
    expect((await req('POST', '/appointments', body(B))).status).toBe(201)
    // same store + overlap → conflict (409)
    expect((await req('POST', '/appointments', body(A))).status).toBe(409)
  })

  it('filters customers by store via their events; business-wide when omitted', async () => {
    const inA = await seedTestCustomer({ name: '店A客', email: 'a@ex.com' })
    const inB = await seedTestCustomer({ name: '店B客', email: 'b@ex.com' })
    await seedTestCustomer({ name: '来店なし', email: 'none@ex.com' })
    await testPrisma.customerVisit.create({ data: { businessId: TEST_BUSINESS_ID, customerId: inA.id, qrReservationId: 9001, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'settled', storeId: A } })
    await testPrisma.customerVisit.create({ data: { businessId: TEST_BUSINESS_ID, customerId: inB.id, qrReservationId: 9002, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'settled', storeId: B } })

    const scoped = await (await req('GET', `/customers?store_id=${A}`)).json()
    expect(scoped.customers.map((c: { name: string }) => c.name)).toEqual(['店A客'])
    const all = await (await req('GET', '/customers')).json()
    expect(all.total).toBe(3)
  })

  it('excludes cancelled-only events from store filter and counts', async () => {
    const cust = await seedTestCustomer({ name: 'キャンセルのみ', email: 'cx@ex.com' })
    await testPrisma.customerVisit.create({ data: { businessId: TEST_BUSINESS_ID, customerId: cust.id, qrReservationId: 9300, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'cancelled', storeId: A } })
    const scoped = await (await req('GET', `/customers?store_id=${A}`)).json()
    expect(scoped.customers.map((c: { name: string }) => c.name)).not.toContain('キャンセルのみ')
    const counts = await (await req('GET', '/customers/counts-by-store')).json()
    expect(counts.counts[A] ?? 0).toBe(0)
  })

  it('counts distinct customers per store from events', async () => {
    const a1 = await seedTestCustomer({ name: 'a1', email: 'a1@ex.com' })
    const a2 = await seedTestCustomer({ name: 'a2', email: 'a2@ex.com' })
    await seedTestCustomer({ name: 'n', email: 'n@ex.com' })
    const visit = (cid: string, qr: number) => testPrisma.customerVisit.create({ data: { businessId: TEST_BUSINESS_ID, customerId: cid, qrReservationId: qr, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'settled', storeId: A } })
    await visit(a1.id, 9101); await visit(a2.id, 9102)
    const res = await req('GET', '/customers/counts-by-store')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts[A]).toBe(2)
    expect(body.total).toBe(3)
  })
})
