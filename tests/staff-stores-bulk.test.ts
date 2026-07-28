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

async function seedStore(name: string) {
  return testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name } })
}

describe('GET /staff-stores — bulk roster assignments', () => {
  afterEach(async () => {
    await testPrisma.staffStore.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
    await testPrisma.store.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
    await cleanupTestData()
  })

  it('returns every assignment in one call, keyed by staff card id', async () => {
    const s1 = await seedTestStaff()
    const s2 = await seedTestStaff({ name: '別スタッフ' })
    const s3 = await seedTestStaff({ name: '全店スタッフ' }) // no rows = every store
    const storeA = await seedStore('店A')
    const storeB = await seedStore('店B')

    await req('PUT', `/staff-stores/${s1.id}`, { store_ids: [storeA.id, storeB.id] })
    await req('PUT', `/staff-stores/${s2.id}`, { store_ids: [storeB.id] })

    const res = await req('GET', '/staff-stores')
    expect(res.status).toBe(200)
    const { assignments } = (await res.json()) as { assignments: Record<string, string[]> }
    expect(assignments[s1.id].sort()).toEqual([storeA.id, storeB.id].sort())
    expect(assignments[s2.id]).toEqual([storeB.id])
    // Absent key = works everywhere — same semantics as the per-staff read.
    expect(assignments[s3.id]).toBeUndefined()
  })

  it('empty business returns an empty map (and /counts is not shadowed)', async () => {
    const res = await req('GET', '/staff-stores')
    expect((await res.json()).assignments).toEqual({})
    const counts = await req('GET', '/staff-stores/counts')
    expect(counts.status).toBe(200)
    expect((await counts.json()).counts).toEqual({})
  })
})
