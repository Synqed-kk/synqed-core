import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  testPrisma,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

// Ensure test API key is set
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

describe('Customer API', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  describe('Auth', () => {
    it('rejects requests without API key', async () => {
      const res = await app.request('/v1/customers', {
        headers: { 'x-business-id': TEST_BUSINESS_ID },
      })
      expect(res.status).toBe(401)
    })

    it('rejects requests without tenant ID', async () => {
      const res = await app.request('/v1/customers', {
        headers: { 'x-api-key': TEST_API_KEY },
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /v1/customers', () => {
    // The live 500: the QR sync find-or-creates by NAME, so the same person
    // under a drifted/unlisted name hits POST again with an email that already
    // exists. createCustomer must be idempotent on (business_id, email) — return
    // the existing customer instead of a unique-violation 500.
    it('duplicate email → returns the existing customer, never 500', async () => {
      const first = await req('POST', '/customers', {
        name: '佐藤一郎',
        email: 'dup-guard@example.com',
      })
      expect(first.status).toBe(201)
      const a = await first.json()

      // Same email, DIFFERENT name (the collision shape).
      const second = await req('POST', '/customers', {
        name: 'ドリフトした名前',
        email: 'dup-guard@example.com',
      })
      expect(second.status).toBe(201)
      const b = await second.json()
      expect(b.id).toBe(a.id) // same row, no duplicate created
      expect(b.name).toBe('佐藤一郎') // existing record returned, not overwritten
    })

    it('creates a customer', async () => {
      const res = await req('POST', '/customers', {
        name: '山田花子',
        furigana: 'ヤマダハナコ',
        email: 'hanako@example.com',
      })

      expect(res.status).toBe(201)
      const customer = await res.json()
      expect(customer.name).toBe('山田花子')
      expect(customer.furigana).toBe('ヤマダハナコ')
      expect(customer.email).toBe('hanako@example.com')
      expect(customer.business_id).toBe(TEST_BUSINESS_ID)
      expect(customer.id).toBeDefined()
    })

    it('persists date_of_birth and gender', async () => {
      const res = await req('POST', '/customers', {
        name: '誕生日太郎',
        date_of_birth: '1990-04-15',
        gender: 'male',
      })
      expect(res.status).toBe(201)
      const customer = await res.json()
      expect(customer.date_of_birth).toBe('1990-04-15')
      expect(customer.gender).toBe('male')

      // round-trips on read
      const read = await req('GET', `/customers/${customer.id}`)
      const fetched = await read.json()
      expect(fetched.date_of_birth).toBe('1990-04-15')
      expect(fetched.gender).toBe('male')
    })

    it('rejects an invalid gender', async () => {
      const res = await req('POST', '/customers', { name: 'X', gender: 'nope' })
      expect(res.status).toBe(400)
    })

    it('rejects empty name', async () => {
      const res = await req('POST', '/customers', { name: '' })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /v1/customers', () => {
    it('lists customers for tenant', async () => {
      await seedTestCustomer()
      await seedTestCustomer({ name: '二人目', email: 'second@example.com' })

      const res = await req('GET', '/customers')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.customers).toHaveLength(2)
      expect(body.total).toBe(2)
      expect(body.page).toBe(1)
    })

    it('searches by name', async () => {
      await seedTestCustomer({ name: '田中太郎', email: 'tanaka@example.com' })
      await seedTestCustomer({ name: '佐藤花子', email: 'sato@example.com' })

      const res = await req('GET', '/customers?search=田中')
      const body = await res.json()
      expect(body.customers).toHaveLength(1)
      expect(body.customers[0].name).toBe('田中太郎')
    })

    it('paginates results', async () => {
      for (let i = 0; i < 5; i++) {
        await seedTestCustomer({ name: `Customer ${i}`, email: `c${i}@example.com` })
      }

      const res = await req('GET', '/customers?page=1&page_size=2')
      const body = await res.json()
      expect(body.customers).toHaveLength(2)
      expect(body.total).toBe(5)
      expect(body.total_pages).toBe(3)
    })
  })

  describe('GET /v1/customers/:id', () => {
    it('returns a customer by ID', async () => {
      const seeded = await seedTestCustomer()

      const res = await req('GET', `/customers/${seeded.id}`)
      expect(res.status).toBe(200)

      const customer = await res.json()
      expect(customer.name).toBe('テスト太郎')
    })

    it('returns 404 for unknown ID', async () => {
      const res = await req('GET', '/customers/00000000-0000-0000-0000-000000000099')
      expect(res.status).toBe(404)
    })
  })

  describe('PUT /v1/customers/:id', () => {
    it('updates a customer', async () => {
      const seeded = await seedTestCustomer()

      const res = await req('PUT', `/customers/${seeded.id}`, {
        name: '更新太郎',
      })
      expect(res.status).toBe(200)

      const customer = await res.json()
      expect(customer.name).toBe('更新太郎')
      expect(customer.email).toBe('test@example.com')
    })
  })

  describe('DELETE /v1/customers/:id', () => {
    it('deletes a customer', async () => {
      const seeded = await seedTestCustomer()

      const res = await req('DELETE', `/customers/${seeded.id}`)
      expect(res.status).toBe(200)

      const getRes = await req('GET', `/customers/${seeded.id}`)
      expect(getRes.status).toBe(404)
    })
  })

  describe('PUT /v1/customers/:id/visits', () => {
    it('upserts visits idempotently by qr_reservation_id', async () => {
      const seeded = await seedTestCustomer()

      const body = {
        visits: [
          {
            qr_reservation_id: 137401,
            used_at: '2026-05-01T03:00:00.000Z',
            status: 'settled',
            course_name: '6回券',
            sales_amount: 10450,
            staff_name: '篠原 夢果',
          },
          {
            qr_reservation_id: 137402,
            used_at: '2026-05-15T03:00:00.000Z',
            status: 'booked',
            sales_amount: 0,
          },
        ],
      }

      const res = await req('PUT', `/customers/${seeded.id}/visits`, body)
      expect(res.status).toBe(200)
      expect((await res.json()).upserted).toBe(2)

      // Re-PUT the same payload: still two rows (no duplicates), values updated.
      const res2 = await req('PUT', `/customers/${seeded.id}/visits`, {
        visits: [
          { ...body.visits[0], sales_amount: 12000 },
          body.visits[1],
        ],
      })
      expect(res2.status).toBe(200)

      const rows = await testPrisma.customerVisit.findMany({
        where: { customerId: seeded.id },
        orderBy: { qrReservationId: 'asc' },
      })
      expect(rows).toHaveLength(2)
      expect(rows[0].qrReservationId).toBe(137401)
      expect(rows[0].salesAmount).toBe(12000)
      expect(rows[1].status).toBe('booked')
    })

    it('rejects an invalid visit payload', async () => {
      const seeded = await seedTestCustomer()
      const res = await req('PUT', `/customers/${seeded.id}/visits`, {
        visits: [{ qr_reservation_id: 1, used_at: 'not-a-date', status: 'settled' }],
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /v1/customers/check-duplicate', () => {
    it('detects duplicate name', async () => {
      await seedTestCustomer({ name: '重複太郎', email: 'dup@example.com' })

      const res = await req('GET', '/customers/check-duplicate?name=重複太郎')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.exists).toBe(true)
      expect(body.existing_name).toBe('重複太郎')
    })

    it('reports no duplicate for new name', async () => {
      const res = await req('GET', '/customers/check-duplicate?name=新規太郎')
      const body = await res.json()
      expect(body.exists).toBe(false)
    })
  })

  describe('Health check', () => {
    it('returns ok without auth', async () => {
      const res = await app.request('/v1/health')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ok')
    })
  })
})
