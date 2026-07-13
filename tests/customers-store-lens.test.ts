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

// Store lens on GET /customers — the everywhere-branch is GONE.
//
// Customers have no store_id; membership derives from events. The old rule
// also passed customers with NO events into EVERY store lens, which leaked
// other-store legacy imports (real PII) to branch-restricted staff — found on
// the Ginza review login 2026-07-14. New contract:
//   - event at store A     → in A's lens, NOT in B's
//   - no events anywhere   → in NO store lens; unfiltered list only
//     (trade-off, accepted: visible store-wide again after first booking)

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

describe('customer list store lens (no everywhere-branch)', () => {
  it('event-pinned customers stay store-scoped; event-less customers are in NO store lens', async () => {
    const pinnedA = await seedTestCustomer({ name: '店舗A 太郎' })
    const eventless = await seedTestCustomer({ name: '未来店 花子' })
    const staff = await seedTestStaff()
    await testPrisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        customerId: pinnedA.id,
        staffId: staff.id,
        storeId: A,
        startsAt: new Date('2026-10-01T01:00:00Z'),
        endsAt: new Date('2026-10-01T02:00:00Z'),
        status: 'SCHEDULED',
        source: 'MANUAL',
      },
    })

    const lensA = await (await req('GET', `/customers?store_id=${A}`)).json()
    const idsA = lensA.customers.map((c: { id: string }) => c.id)
    expect(idsA).toContain(pinnedA.id)
    expect(idsA).not.toContain(eventless.id)

    const lensB = await (await req('GET', `/customers?store_id=${B}`)).json()
    const idsB = lensB.customers.map((c: { id: string }) => c.id)
    expect(idsB).not.toContain(pinnedA.id)
    expect(idsB).not.toContain(eventless.id)
  })

  it('the UNFILTERED list still returns event-less customers', async () => {
    const eventless = await seedTestCustomer({ name: '未来店 花子' })
    const all = await (await req('GET', '/customers')).json()
    expect(all.customers.map((c: { id: string }) => c.id)).toContain(
      eventless.id,
    )
  })
})
