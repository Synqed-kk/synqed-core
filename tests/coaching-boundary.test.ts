import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
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
function req(method: string, path: string) {
  return app.request(`/v1${path}`, { method, headers })
}

const STORE_A = '11111111-1111-1111-1111-111111111111'
const STORE_B = '22222222-2222-2222-2222-222222222222'

afterEach(async () => {
  await cleanupTestData()
})

// There is no coaching/aggregation service yet. The invariant we lock in here is
// the one coaching will rely on: business-scoped aggregates pool events across
// every store within the business and are NOT partitioned by store_id. store_id
// is only a nullable VIEW-FILTER on events — it must never shrink a
// business-scoped read.
describe('coaching boundary — aggregation keyed on businessId, not store_id', () => {
  it('pools customers from two different stores into the business-wide total', async () => {
    const inA = await seedTestCustomer({ name: '店A客', email: 'ca@ex.com' })
    const inB = await seedTestCustomer({ name: '店B客', email: 'cb@ex.com' })
    await testPrisma.customerVisit.create({
      data: { businessId: TEST_BUSINESS_ID, customerId: inA.id, qrReservationId: 7001, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'settled', storeId: STORE_A },
    })
    await testPrisma.customerVisit.create({
      data: { businessId: TEST_BUSINESS_ID, customerId: inB.id, qrReservationId: 7002, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'settled', storeId: STORE_B },
    })

    // Business-scoped read (no store_id): both stores' customers are pooled.
    const all = await (await req('GET', '/customers')).json()
    expect(all.total).toBe(2)
    expect(all.customers.map((c: { name: string }) => c.name).sort()).toEqual(['店A客', '店B客'])

    // counts-by-store: the per-store view splits them, but `total` stays the
    // un-partitioned business headcount — proving the aggregate is businessId-keyed.
    const counts = await (await req('GET', '/customers/counts-by-store')).json()
    expect(counts.total).toBe(2)
    expect(counts.counts[STORE_A]).toBe(1)
    expect(counts.counts[STORE_B]).toBe(1)
  })

  it('store_id is a nullable view-filter that never shrinks the business-scoped read', async () => {
    const inA = await seedTestCustomer({ name: 'A', email: 'fa@ex.com' })
    const inB = await seedTestCustomer({ name: 'B', email: 'fb@ex.com' })
    await testPrisma.customerVisit.create({
      data: { businessId: TEST_BUSINESS_ID, customerId: inA.id, qrReservationId: 7101, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'settled', storeId: STORE_A },
    })
    await testPrisma.customerVisit.create({
      data: { businessId: TEST_BUSINESS_ID, customerId: inB.id, qrReservationId: 7102, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'settled', storeId: STORE_B },
    })

    // Filtering by one store narrows the VIEW to that store's customer.
    const scopedA = await (await req('GET', `/customers?store_id=${STORE_A}`)).json()
    expect(scopedA.customers.map((c: { name: string }) => c.name)).toEqual(['A'])

    // Omitting store_id pools both stores — the filter is additive/nullable, not
    // a partition baked into the business-scoped aggregate.
    const all = await (await req('GET', '/customers')).json()
    expect(all.total).toBe(2)
    expect(all.total).toBeGreaterThan(scopedA.total)
  })
})
