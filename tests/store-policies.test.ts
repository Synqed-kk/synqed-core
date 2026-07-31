import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

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
async function seedStore(name = '店') {
  return testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name } })
}

afterEach(async () => {
  await testPrisma.$executeRawUnsafe(
    `DO $$ BEGIN
       PERFORM set_config('app.audit_scrub', 'on', true);
       DELETE FROM audit_log WHERE business_id = '${TEST_BUSINESS_ID}';
     END $$`,
  )
  await testPrisma.storeBookingPolicy.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.businessGrant.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('store booking policies', () => {
  it('unsaved store reads platform defaults (source: default); unknown store 404s', async () => {
    const store = await seedStore()
    const p = await (await req('GET', `/store-policies/${store.id}`)).json()
    expect(p.source).toBe('default')
    expect(p.booking_open_days).toBe(30)
    expect(p.cancel_free_until_hours).toBe(24)
    const missing = await req('GET', '/store-policies/00000000-0000-0000-0000-000000000099')
    expect(missing.status).toBe(404)
  })

  it('HQ gate on writes; partial upsert keeps other fields; audit rides the same transaction', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const stylist = await seedTestStaff({ name: '一般', role: 'STYLIST' })
    const store = await seedStore()

    const denied = await req('PUT', `/store-policies/${store.id}`, {
      cutoff_minutes: 180, acting_staff_id: stylist.id,
    })
    expect(denied.status).toBe(403)

    const first = await (
      await req('PUT', `/store-policies/${store.id}`, {
        cutoff_minutes: 180,
        cancel_late_pct: 50,
        acting_staff_id: owner.id,
        audit: {
          actor_id: owner.id, actor_type: 'staff', category: 'settings',
          action: 'store_policy.edit', request_id: 'pol-1',
        },
      })
    ).json()
    expect(first.source).toBe('custom')
    expect(first.cutoff_minutes).toBe(180)
    expect(first.booking_open_days).toBe(30) // default filled on first save

    // partial update: only one field changes
    const second = await (
      await req('PUT', `/store-policies/${store.id}`, {
        booking_open_days: 60, acting_staff_id: owner.id,
      })
    ).json()
    expect(second.booking_open_days).toBe(60)
    expect(second.cutoff_minutes).toBe(180)
    expect(second.cancel_late_pct).toBe(50)

    const auditRows = await testPrisma.auditLog.findMany({
      where: { businessId: TEST_BUSINESS_ID, requestId: 'pol-1' },
    })
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0].targetId).toBe(store.id)
  })

  it('list returns effective policy for every store; validation rejects out-of-range', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const a = await seedStore('A')
    const b = await seedStore('B')
    await req('PUT', `/store-policies/${a.id}`, { booking_open_days: 14, acting_staff_id: owner.id })

    const list = await (await req('GET', '/store-policies')).json()
    expect(list.policies).toHaveLength(2)
    const pa = list.policies.find((p: { store_id: string }) => p.store_id === a.id)
    const pb = list.policies.find((p: { store_id: string }) => p.store_id === b.id)
    expect(pa.source).toBe('custom')
    expect(pa.booking_open_days).toBe(14)
    expect(pb.source).toBe('default')

    const bad = await req('PUT', `/store-policies/${a.id}`, {
      cancel_late_pct: 150, acting_staff_id: owner.id,
    })
    expect(bad.status).toBe(400)
  })
})
