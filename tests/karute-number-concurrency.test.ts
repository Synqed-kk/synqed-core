import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index.js'
import { createCustomer } from '../src/services/customer.service.js'
import { testPrisma, TEST_BUSINESS_ID, TEST_API_KEY, cleanupTestData, seedTestCustomer } from './setup.js'

process.env.API_KEYS = TEST_API_KEY

// Holds the karute-number lock in another session until the returned release()
// is called. The retry alone can absorb collisions, so only a create that
// WAITS on this lock proves the lock is taken.
async function holdKaruteNumberLock() {
  let release!: () => void
  let locked!: () => void
  const isLocked = new Promise<void>(r => (locked = r))
  const done = testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`karute-number:${TEST_BUSINESS_ID}`}, 0))`
    locked()
    await new Promise<void>(r => (release = r))
  }, { timeout: 20_000 })
  await isLocked
  return async () => { release(); await done }
}

// CORE-39: 4 concurrent creates × 30 customers in one business used to fail
// ~2 of 30 with "exhausted karuteNumber retries" (max+1 read outside a lock).
describe('createCustomer karute number allocation under concurrency', () => {
  beforeEach(cleanupTestData)
  afterAll(cleanupTestData)

  it('creates 30 customers with 4 in flight: no errors, consecutive numbers from MAX+1', async () => {
    await seedTestCustomer({ karuteNumber: 100 })
    const names = Array.from({ length: 30 }, (_, i) => `並行${i}`)
    const errors: unknown[] = []
    const numbers: number[] = []
    const queue = [...names]
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        try {
          numbers.push(Number((await createCustomer(TEST_BUSINESS_ID, { name })).karute_number))
        } catch (e) {
          errors.push(e)
        }
      }
    }))

    expect(errors).toEqual([])
    expect(numbers).toHaveLength(30)
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => 101 + i))
    expect(await testPrisma.customer.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(31)
  })

  it('waits for the per-business lock before it allocates', async () => {
    const release = await holdKaruteNumberLock()
    let settled = false
    const create = createCustomer(TEST_BUSINESS_ID, { name: '待機' }).finally(() => { settled = true })
    await new Promise(r => setTimeout(r, 500))
    expect(settled).toBe(false)
    await release()
    expect((await create).karute_number).toBeTruthy()
  })

  // The wait ends at the 5 s lock_timeout, so this test is slow.
  it('answers 503 with Retry-After when the lock queue times out', async () => {
    const release = await holdKaruteNumberLock()
    try {
      const res = await app.request('/v1/customers', {
        method: 'POST',
        headers: { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '時間切れ' }),
      })
      expect(res.status).toBe(503)
      expect(res.headers.get('Retry-After')).toBe('1')
      expect((await res.json()).code).toBe('SLOT_CONTENTION')
    } finally {
      await release()
    }
    expect(await testPrisma.customer.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  }, 20_000)

  // lock_timeout bounds only the karute-number queue. A create that waits
  // longer than that on an uncommitted same-email row still returns it.
  it('a create that waits on an uncommitted same-email row returns that customer', async () => {
    let release!: () => void
    let inserted!: () => void
    const isInserted = new Promise<void>(r => (inserted = r))
    const holder = testPrisma.$transaction(async (tx) => {
      await tx.customer.create({ data: { businessId: TEST_BUSINESS_ID, name: '先客', email: 'same@example.com', karuteNumber: 999 } })
      inserted()
      await new Promise<void>(r => (release = r))
    }, { timeout: 40_000 })
    await isInserted
    const create = createCustomer(TEST_BUSINESS_ID, { name: '後客', email: 'same@example.com' })
    await new Promise(r => setTimeout(r, 16_000))
    release()
    await holder
    expect((await create).karute_number).toBe(999)
  }, 40_000)
})

