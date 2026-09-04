import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SynqedClient } from '../packages/client/src/index.js'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  testPrisma,
  TEST_API_KEY,
  TEST_BUSINESS_ID,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

describe('packs.listRedemptions linkage fields', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await cleanupTestData()
  })

  it('returns stored appointment and karute links, including null links, through the SDK', async () => {
    const customer = await seedTestCustomer()
    const packs = await Promise.all(
      [1, 2].map((purchaseRound) =>
        testPrisma.ticketPack.create({
          data: {
            businessId: TEST_BUSINESS_ID,
            customerId: customer.id,
            kind: 'pack',
            packSize: 10,
            unitPrice: 8_000,
            purchaseRound,
            status: 'active',
          },
        }),
      ),
    )
    const appointmentId = randomUUID()
    const karuteRecordId = randomUUID()
    await testPrisma.packRedemption.createMany({
      data: [
        {
          businessId: TEST_BUSINESS_ID,
          packId: packs[0].id,
          customerId: customer.id,
          redeemedOn: new Date('2026-09-01'),
          appointmentId,
          karuteRecordId,
        },
        {
          businessId: TEST_BUSINESS_ID,
          packId: packs[1].id,
          customerId: customer.id,
          redeemedOn: new Date('2026-09-02'),
        },
      ],
    })

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        return app.request(`${url.pathname}${url.search}`, init)
      }),
    )
    const client = new SynqedClient({
      baseUrl: 'http://core.test',
      apiKey: TEST_API_KEY,
      businessId: TEST_BUSINESS_ID,
    })

    const redemptions = await client.packs.listRedemptions(customer.id)

    expect(redemptions).toEqual(
      expect.arrayContaining([
        {
          pack_id: packs[0].id,
          redeemed_on: '2026-09-01',
          appointment_id: appointmentId,
          karute_record_id: karuteRecordId,
        },
        {
          pack_id: packs[1].id,
          redeemed_on: '2026-09-02',
          appointment_id: null,
          karute_record_id: null,
        },
      ]),
    )
  })
})
