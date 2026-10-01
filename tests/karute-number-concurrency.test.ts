import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCustomer } from '../src/services/customer.service.js'
import { testPrisma, TEST_BUSINESS_ID, cleanupTestData, seedTestCustomer } from './setup.js'

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
})
