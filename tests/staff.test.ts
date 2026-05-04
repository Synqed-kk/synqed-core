import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestStaff,
  seedTestKaruteRecord,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

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

describe('Staff DELETE guards', () => {
  beforeEach(async () => {
    await cleanupTestData()
  })

  afterEach(async () => {
    await cleanupTestData()
  })

  it('happy path: deletes one of two staff members', async () => {
    const staff1 = await seedTestStaff({ name: 'スタッフA' })
    const staff2 = await seedTestStaff({ name: 'スタッフB' })

    const res = await req('DELETE', `/staff/${staff1.id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Staff2 still exists
    const getRes = await req('GET', `/staff/${staff2.id}`)
    expect(getRes.status).toBe(200)
  })

  it('guard: returns 400 when deleting the only remaining staff member', async () => {
    const staff = await seedTestStaff()

    const res = await req('DELETE', `/staff/${staff.id}`)
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toMatch(/last staff member/i)
  })

  it('guard: returns 400 when staff has attributed karute records', async () => {
    const staff1 = await seedTestStaff({ name: 'スタッフA' })
    const staff2 = await seedTestStaff({ name: 'スタッフB' })

    // Attribute 2 karute records to staff1
    await seedTestKaruteRecord({ staffId: staff1.id })
    await seedTestKaruteRecord({ staffId: staff1.id })

    const res = await req('DELETE', `/staff/${staff1.id}`)
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toMatch(/2 karute records/i)

    // staff2 is still deletable (no records, and staff1 still exists)
    // so there are still 2 staff total — staff2 should be deletable
    const res2 = await req('DELETE', `/staff/${staff2.id}`)
    expect(res2.status).toBe(200)
  })

  it('guard: returns 400 with singular message when staff has exactly 1 record', async () => {
    const staff1 = await seedTestStaff({ name: 'スタッフA' })
    await seedTestStaff({ name: 'スタッフB' })

    await seedTestKaruteRecord({ staffId: staff1.id })

    const res = await req('DELETE', `/staff/${staff1.id}`)
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toMatch(/1 karute record[^s]/i)
  })

  it('returns 404 when deleting a non-existent staff ID', async () => {
    // Seed at least one extra staff so the "last member" guard doesn't fire first
    await seedTestStaff()

    const res = await req('DELETE', '/staff/00000000-0000-0000-0000-000000000099')
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toMatch(/staff not found/i)
  })
})
