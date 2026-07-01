import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import app from '../src/index.js'
import { testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

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

async function cleanupInvites() {
  await testPrisma.invite.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
}

// invited_staff_id is the link that lets acceptInvite ATTACH an existing staff
// row (set its user_id) instead of minting a duplicate. It must round-trip
// through create AND the pre-auth by-token lookup (accept reads it from there).
describe('invites carry invited_staff_id', () => {
  beforeEach(cleanupInvites)
  afterEach(cleanupInvites)

  it('stores and returns invited_staff_id on create', async () => {
    const staffId = '11111111-1111-1111-1111-111111111111'
    const res = await req('POST', '/invites', {
      email: 'existing@example.com',
      role: 'STYLIST',
      token: 'a'.repeat(64),
      invited_staff_id: staffId,
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.invited_staff_id).toBe(staffId)
  })

  it('exposes invited_staff_id via the public by-token lookup', async () => {
    const staffId = '22222222-2222-2222-2222-222222222222'
    const token = 'b'.repeat(64)
    await req('POST', '/invites', {
      email: 'x@example.com',
      role: 'STYLIST',
      token,
      invited_staff_id: staffId,
    })
    const res = await app.request(`/v1/invites/by-token/${token}`, { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invited_staff_id).toBe(staffId)
  })

  it('defaults invited_staff_id to null for an email-only invite', async () => {
    const res = await req('POST', '/invites', {
      email: 'new@example.com',
      role: 'STYLIST',
      token: 'c'.repeat(64),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.invited_staff_id).toBeNull()
  })
})
