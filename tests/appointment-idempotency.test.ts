import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { prisma } from '../src/db/client.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const baseHeaders = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}

function req(method: string, path: string, body?: unknown, extra?: Record<string, string>) {
  const init: RequestInit = { method, headers: { ...baseHeaders, ...extra } }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

const slot = (staffId: string, customerId: string, hour: number) => ({
  customer_id: customerId,
  staff_id: staffId,
  starts_at: `2026-09-01T0${hour}:00:00.000Z`,
  ends_at: `2026-09-01T0${hour}:30:00.000Z`,
})

async function cleanupKeys() {
  await prisma.idempotencyKey.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
}

describe('POST /appointments — Idempotency-Key dedup', () => {
  afterEach(async () => {
    await cleanupKeys()
    await cleanupTestData()
  })

  it('replays the same appointment for a retried key instead of double-booking', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()

    const first = await req('POST', '/appointments', slot(staff.id, customer.id, 1), {
      'Idempotency-Key': 'retry-abc',
    })
    expect(first.status).toBe(201)
    const created = await first.json()

    const retry = await req('POST', '/appointments', slot(staff.id, customer.id, 1), {
      'Idempotency-Key': 'retry-abc',
    })
    expect(retry.status).toBe(200)
    const replayed = await retry.json()
    expect(replayed.id).toBe(created.id)

    const count = await prisma.appointment.count({
      where: { businessId: TEST_BUSINESS_ID, staffId: staff.id },
    })
    expect(count).toBe(1)
  })

  it('different keys create different appointments', async () => {
    const staff = await seedTestStaff()
    const c1 = await seedTestCustomer()
    const c2 = await seedTestCustomer({ email: 'c2@test.example' })

    const a = await req('POST', '/appointments', slot(staff.id, c1.id, 1), {
      'Idempotency-Key': 'key-1',
    })
    const b = await req('POST', '/appointments', slot(staff.id, c2.id, 2), {
      'Idempotency-Key': 'key-2',
    })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect((await a.json()).id).not.toBe((await b.json()).id)
  })

  it('no header — behavior unchanged, no key rows written', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const res = await req('POST', '/appointments', slot(staff.id, customer.id, 1))
    expect(res.status).toBe(201)
    expect(await prisma.idempotencyKey.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it('a failed create releases the key so a retry can succeed', async () => {
    const staff = await seedTestStaff()
    const c1 = await seedTestCustomer()
    const c2 = await seedTestCustomer({ email: 'c2@test.example' })

    // Occupy the slot without a key.
    const blocker = await req('POST', '/appointments', slot(staff.id, c1.id, 1))
    expect(blocker.status).toBe(201)

    // Keyed create 409s on overlap — key must be released, not poisoned.
    const conflicted = await req('POST', '/appointments', slot(staff.id, c2.id, 1), {
      'Idempotency-Key': 'retry-after-409',
    })
    expect(conflicted.status).toBe(409)
    expect(await prisma.idempotencyKey.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)

    // Same key retried on a free slot now succeeds.
    const retried = await req('POST', '/appointments', slot(staff.id, c2.id, 2), {
      'Idempotency-Key': 'retry-after-409',
    })
    expect(retried.status).toBe(201)
  })

  it('concurrent duplicates: one appointment total, losers replay or get retryable in_flight', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()

    for (let round = 0; round < 5; round++) {
      const key = `race-${round}`
      const body = slot(staff.id, customer.id, (round + 1) as number)
      const [a, b] = await Promise.all([
        req('POST', '/appointments', body, { 'Idempotency-Key': key }),
        req('POST', '/appointments', body, { 'Idempotency-Key': key }),
      ])
      const statuses = [a.status, b.status]
      // Exactly one winner (201); the loser replays (200), sees in-flight
      // (503), or — if it raced past the key claim into the slot lock — loses
      // on overlap/customer-slot (409). Never two 201s.
      expect(statuses.filter((s) => s === 201)).toHaveLength(1)
      expect([200, 409, 503]).toContain(statuses.find((s) => s !== 201))
      const rows = await prisma.appointment.findMany({
        where: { businessId: TEST_BUSINESS_ID, staffId: staff.id, startsAt: new Date(body.starts_at) },
      })
      expect(rows).toHaveLength(1)
    }
  })

  it('replay whose appointment was deleted returns a distinct 409', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()

    const first = await req('POST', '/appointments', slot(staff.id, customer.id, 1), {
      'Idempotency-Key': 'gone-key',
    })
    const created = await first.json()
    await req('DELETE', `/appointments/${created.id}`)

    const replay = await req('POST', '/appointments', slot(staff.id, customer.id, 1), {
      'Idempotency-Key': 'gone-key',
    })
    expect(replay.status).toBe(409)
    expect((await replay.json()).code).toBe('IDEMPOTENT_REPLAY_GONE')
  })
})
