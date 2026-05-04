import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestStaff,
  testPrisma,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const BUSINESS_B_ID = '00000000-0000-0000-0000-000000000002'

const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}

const headersB = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': BUSINESS_B_ID,
  'Content-Type': 'application/json',
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

function reqB(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: headersB }
  if (body !== undefined) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

describe('Staff PIN endpoints', () => {
  beforeAll(async () => {
    // Warm up DB connections: run a health check and initial cleanup so the
    // first test doesn't hit a cold pgbouncer connection that can't see
    // freshly committed rows via updateMany.
    await cleanupTestData()
    await app.request('/v1/health')
  })

  afterEach(async () => {
    await cleanupTestData()
  })

  it('PUT /:id/pin sets a PIN and GET /:id/pin returns has_pin: true', async () => {
    const staff = await seedTestStaff()

    const putRes = await req('PUT', `/staff/${staff.id}/pin`, { pin: '1234' })
    expect(putRes.status).toBe(200)
    const putBody = await putRes.json()
    expect(putBody.success).toBe(true)

    const getRes = await req('GET', `/staff/${staff.id}/pin`)
    expect(getRes.status).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.has_pin).toBe(true)
  })

  it('PUT /:id/pin with non-4-digit PIN returns 400', async () => {
    const staff = await seedTestStaff()

    const res = await req('PUT', `/staff/${staff.id}/pin`, { pin: '12' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/4 digits/i)
  })

  it('PUT /:id/pin with letters returns 400', async () => {
    const staff = await seedTestStaff()

    const res = await req('PUT', `/staff/${staff.id}/pin`, { pin: 'abcd' })
    expect(res.status).toBe(400)
  })

  it('DELETE /:id/pin removes the PIN and GET returns has_pin: false', async () => {
    const staff = await seedTestStaff()

    await req('PUT', `/staff/${staff.id}/pin`, { pin: '9999' })

    const delRes = await req('DELETE', `/staff/${staff.id}/pin`)
    expect(delRes.status).toBe(200)
    const delBody = await delRes.json()
    expect(delBody.success).toBe(true)

    const getRes = await req('GET', `/staff/${staff.id}/pin`)
    expect(getRes.status).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.has_pin).toBe(false)
  })

  it('POST /:id/pin/verify with correct PIN returns { valid: true }', async () => {
    const staff = await seedTestStaff()

    await req('PUT', `/staff/${staff.id}/pin`, { pin: '5678' })

    const res = await req('POST', `/staff/${staff.id}/pin/verify`, { pin: '5678' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.valid).toBe(true)
    expect(body.no_pin).toBeUndefined()
  })

  it('POST /:id/pin/verify with wrong PIN returns { valid: false }', async () => {
    const staff = await seedTestStaff()

    await req('PUT', `/staff/${staff.id}/pin`, { pin: '5678' })

    const res = await req('POST', `/staff/${staff.id}/pin/verify`, { pin: '0000' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.valid).toBe(false)
  })

  it('POST /:id/pin/verify when no PIN set returns { valid: true, no_pin: true }', async () => {
    const staff = await seedTestStaff()

    const res = await req('POST', `/staff/${staff.id}/pin/verify`, { pin: 'anything' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.valid).toBe(true)
    expect(body.no_pin).toBe(true)
  })

  it('PIN is stored as a 64-char hex hash, not the raw PIN', async () => {
    const staff = await seedTestStaff()

    await req('PUT', `/staff/${staff.id}/pin`, { pin: '1234' })

    const row = await testPrisma.staff.findFirst({
      where: { id: staff.id },
      select: { pinHash: true },
    })
    expect(row).not.toBeNull()
    expect(row!.pinHash).not.toBeNull()
    expect(row!.pinHash).not.toBe('1234')
    expect(row!.pinHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('cross-tenant: PUT /:id/pin for tenant A staff from tenant B headers returns 404', async () => {
    const staff = await seedTestStaff()

    const res = await reqB('PUT', `/staff/${staff.id}/pin`, { pin: '1111' })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('cross-tenant: POST /:id/pin/verify for tenant A staff from tenant B headers returns 404', async () => {
    const staff = await seedTestStaff()
    await req('PUT', `/staff/${staff.id}/pin`, { pin: '2222' })

    const res = await reqB('POST', `/staff/${staff.id}/pin/verify`, { pin: '2222' })
    expect(res.status).toBe(404)
  })

  it('cross-tenant: GET /:id/pin for tenant A staff from tenant B headers returns 404', async () => {
    const staff = await seedTestStaff()
    await req('PUT', `/staff/${staff.id}/pin`, { pin: '3333' })

    const res = await reqB('GET', `/staff/${staff.id}/pin`)
    expect(res.status).toBe(404)
  })

  it('PUT /:id/pin for unknown staff ID returns 404', async () => {
    const res = await req('PUT', '/staff/00000000-0000-0000-0000-000000000099/pin', { pin: '1234' })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id/pin for unknown staff ID returns 404', async () => {
    const res = await req('DELETE', '/staff/00000000-0000-0000-0000-000000000099/pin')
    expect(res.status).toBe(404)
  })

  it('GET /:id/pin for unknown staff ID returns 404', async () => {
    const res = await req('GET', '/staff/00000000-0000-0000-0000-000000000099/pin')
    expect(res.status).toBe(404)
  })
})
