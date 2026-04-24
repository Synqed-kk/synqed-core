import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  seedTestKaruteRecord,
  TEST_TENANT_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const headers = {
  'x-api-key': TEST_API_KEY,
  'x-tenant-id': TEST_TENANT_ID,
  'Content-Type': 'application/json',
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000002'

describe('Karute Entry add/delete endpoints', () => {
  beforeEach(async () => {
    await cleanupTestData()
  })

  afterEach(async () => {
    await cleanupTestData()
  })

  describe('POST /karute-records/:id/entries', () => {
    it('adds a manual entry to an existing record and returns is_manual', async () => {
      const customer = await seedTestCustomer()
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ customerId: customer.id, staffId: staff.id })

      const res = await req('POST', `/karute-records/${record.id}/entries`, {
        category: 'PREFERENCE',
        content: '赤みがかった茶色を好む',
        is_manual: true,
      })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.id).toBeDefined()
      expect(body.karute_record_id).toBe(record.id)
      expect(body.category).toBe('PREFERENCE')
      expect(body.content).toBe('赤みがかった茶色を好む')
      expect(body.is_manual).toBe(true)
    })

    it('adds a non-manual entry with is_manual defaulting to false', async () => {
      const customer = await seedTestCustomer()
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ customerId: customer.id, staffId: staff.id })

      const res = await req('POST', `/karute-records/${record.id}/entries`, {
        category: 'TREATMENT',
        content: 'カラー施術',
      })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.is_manual).toBe(false)
    })

    it('accepts null confidence for manual entries', async () => {
      const customer = await seedTestCustomer()
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ customerId: customer.id, staffId: staff.id })

      const res = await req('POST', `/karute-records/${record.id}/entries`, {
        category: 'SYMPTOM',
        content: '頭皮が敏感',
        confidence: null,
        is_manual: true,
      })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.confidence).toBe(0) // null → default 0
    })

    it('returns 404 when adding entry to non-existent record', async () => {
      const fakeId = '00000000-0000-0000-0000-999999999999'

      const res = await req('POST', `/karute-records/${fakeId}/entries`, {
        category: 'OTHER',
        content: 'test',
      })

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toMatch(/not found/i)
    })

    it('returns 404 when adding entry to a different tenant record', async () => {
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ staffId: staff.id })

      // Request with a different tenant header
      const otherHeaders = {
        'x-api-key': TEST_API_KEY,
        'x-tenant-id': OTHER_TENANT_ID,
        'Content-Type': 'application/json',
      }
      const res = await app.request(`/v1/karute-records/${record.id}/entries`, {
        method: 'POST',
        headers: otherHeaders,
        body: JSON.stringify({ category: 'OTHER', content: 'test' }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 for invalid category', async () => {
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ staffId: staff.id })

      const res = await req('POST', `/karute-records/${record.id}/entries`, {
        category: 'INVALID_CATEGORY',
        content: 'test',
      })

      expect(res.status).toBe(400)
    })

    it('auto-increments sort_order based on existing entries', async () => {
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ staffId: staff.id })

      const res1 = await req('POST', `/karute-records/${record.id}/entries`, {
        category: 'OTHER',
        content: 'first',
      })
      const body1 = await res1.json()

      const res2 = await req('POST', `/karute-records/${record.id}/entries`, {
        category: 'OTHER',
        content: 'second',
      })
      const body2 = await res2.json()

      expect(body2.sort_order).toBeGreaterThan(body1.sort_order)
    })
  })

  describe('DELETE /karute-records/:id/entries/:entryId', () => {
    it('deletes an existing entry successfully', async () => {
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ staffId: staff.id })

      // First add an entry
      const addRes = await req('POST', `/karute-records/${record.id}/entries`, {
        category: 'TREATMENT',
        content: 'ハイライト',
        is_manual: true,
      })
      expect(addRes.status).toBe(201)
      const { id: entryId } = await addRes.json()

      // Now delete it
      const delRes = await req('DELETE', `/karute-records/${record.id}/entries/${entryId}`)
      expect(delRes.status).toBe(200)
      const delBody = await delRes.json()
      expect(delBody.success).toBe(true)
    })

    it('returns 404 when deleting from a different tenant record', async () => {
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ staffId: staff.id })

      // Add entry under TEST_TENANT_ID
      const addRes = await req('POST', `/karute-records/${record.id}/entries`, {
        category: 'OTHER',
        content: 'to be deleted',
      })
      const { id: entryId } = await addRes.json()

      // Attempt delete with a different tenant
      const otherHeaders = {
        'x-api-key': TEST_API_KEY,
        'x-tenant-id': OTHER_TENANT_ID,
        'Content-Type': 'application/json',
      }
      const delRes = await app.request(
        `/v1/karute-records/${record.id}/entries/${entryId}`,
        { method: 'DELETE', headers: otherHeaders },
      )
      expect(delRes.status).toBe(404)
    })

    it('returns 404 when deleting a non-existent entry', async () => {
      const staff = await seedTestStaff()
      const record = await seedTestKaruteRecord({ staffId: staff.id })
      const fakeEntryId = '00000000-0000-0000-0000-999999999999'

      const res = await req('DELETE', `/karute-records/${record.id}/entries/${fakeEntryId}`)
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toMatch(/not found/i)
    })

    it('returns 404 when the karute record itself does not exist', async () => {
      const fakeRecordId = '00000000-0000-0000-0000-999999999998'
      const fakeEntryId = '00000000-0000-0000-0000-999999999999'

      const res = await req('DELETE', `/karute-records/${fakeRecordId}/entries/${fakeEntryId}`)
      expect(res.status).toBe(404)
    })
  })
})
