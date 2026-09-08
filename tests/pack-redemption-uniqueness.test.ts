import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTestData, seedTestCustomer, testPrisma, TEST_BUSINESS_ID } from './setup.js'

afterEach(cleanupTestData)

describe('CORE-7 database burn guard', () => {
  it('rejects concurrent active burns and permits a replacement after undo', async () => {
    const customer = await seedTestCustomer()
    const appointmentId = randomUUID()
    const pack = await testPrisma.ticketPack.create({ data: {
      businessId: TEST_BUSINESS_ID, customerId: customer.id, kind: 'pack',
      packSize: 10, unitPrice: 8000, status: 'active',
    } })
    const data = { businessId: TEST_BUSINESS_ID, customerId: customer.id, packId: pack.id,
      appointmentId, redeemedOn: new Date('2026-07-09') }
    const results = await Promise.allSettled([
      testPrisma.packRedemption.create({ data }), testPrisma.packRedemption.create({ data }),
    ])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(row => row.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('P2002')
    await testPrisma.packRedemption.updateMany({ where: { appointmentId }, data: { removedAt: new Date() } })
    await testPrisma.packRedemption.create({ data })
    expect(await testPrisma.packRedemption.count({ where: { appointmentId, removedAt: null } })).toBe(1)
  })
})
