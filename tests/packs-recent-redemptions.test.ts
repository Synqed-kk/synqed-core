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

async function seedPack(customerId: string, overrides?: Record<string, any>) {
  return testPrisma.ticketPack.create({
    data: {
      businessId: TEST_BUSINESS_ID,
      customerId,
      kind: 'pack',
      packSize: 10,
      unitPrice: 8000,
      status: 'active',
      ...overrides,
    },
  })
}

async function seedRedemption(packId: string, customerId: string, redeemedOn: string) {
  return testPrisma.packRedemption.create({
    data: {
      businessId: TEST_BUSINESS_ID,
      packId,
      customerId,
      redeemedOn: new Date(redeemedOn),
    },
  })
}

describe('GET /packs/redemptions/recent — priced rows', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('returns pack_id + unit_price alongside the existing fields', async () => {
    const c = await seedTestCustomer()
    const pack = await seedPack(c.id, { unitPrice: 8500 })
    await seedRedemption(pack.id, c.id, '2026-07-05')

    const res = await app.request('/v1/packs/redemptions/recent?since=2026-07-01', { headers })
    expect(res.status).toBe(200)
    const { redemptions } = await res.json()
    expect(redemptions).toHaveLength(1)
    expect(redemptions[0]).toEqual({
      customer_id: c.id,
      appointment_id: null,
      redeemed_on: '2026-07-05',
      pack_id: pack.id,
      unit_price: 8500,
    })
  })

  it('prices burns on exhausted/cancelled packs — not just active ones', async () => {
    const c = await seedTestCustomer()
    const exhausted = await seedPack(c.id, { unitPrice: 6000, status: 'exhausted' })
    const cancelled = await seedPack(c.id, { unitPrice: 9000, status: 'cancelled' })
    await seedRedemption(exhausted.id, c.id, '2026-07-03')
    await seedRedemption(cancelled.id, c.id, '2026-07-04')

    const res = await app.request('/v1/packs/redemptions/recent?since=2026-07-01', { headers })
    const { redemptions } = await res.json()
    const prices = redemptions.map((r: { unit_price: number | null }) => r.unit_price).sort()
    expect(prices).toEqual([6000, 9000])
  })

  it('returns unit_price null for an orphaned redemption (pack row gone)', async () => {
    const c = await seedTestCustomer()
    const pack = await seedPack(c.id)
    await seedRedemption(pack.id, c.id, '2026-07-06')
    await testPrisma.ticketPack.delete({ where: { id: pack.id } })

    const res = await app.request('/v1/packs/redemptions/recent?since=2026-07-01', { headers })
    const { redemptions } = await res.json()
    expect(redemptions).toHaveLength(1)
    expect(redemptions[0].unit_price).toBeNull()
  })

  it('still honors the since cutoff', async () => {
    const c = await seedTestCustomer()
    const pack = await seedPack(c.id)
    await seedRedemption(pack.id, c.id, '2026-06-20')
    await seedRedemption(pack.id, c.id, '2026-07-02')

    const res = await app.request('/v1/packs/redemptions/recent?since=2026-07-01', { headers })
    const { redemptions } = await res.json()
    expect(redemptions).toHaveLength(1)
    expect(redemptions[0].redeemed_on).toBe('2026-07-02')
  })
})
