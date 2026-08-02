import { describe, it, expect, afterEach, vi } from 'vitest'

// vi.mock is hoisted before imports by vitest — intercepts getStorage()
// throughout the module graph in this test file (same pattern as staff-avatar).
vi.mock('../src/services/storage.js', () => ({
  getStorage: vi.fn(() => ({
    from: vi.fn((bucket: string) => ({
      upload: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn((path: string) => ({
        data: { signedUrl: `https://fake.supabase.co/signed/${bucket}/${path}` },
      })),
      remove: vi.fn().mockResolvedValue({ error: null }),
    })),
  })),
}))

import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  testPrisma,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const authHeaders = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID }

function uploadReq(customerId: string, fields: Record<string, string>, idemKey?: string) {
  const fd = new FormData()
  fd.append('file', new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' }))
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return app.request(`/v1/customers/${customerId}/photos`, {
    method: 'POST',
    headers: { ...authHeaders, ...(idemKey ? { 'Idempotency-Key': idemKey } : {}) },
    body: fd,
  })
}

async function seedSession(customerId: string, staffId: string) {
  return testPrisma.recordingSession.create({
    data: { businessId: TEST_BUSINESS_ID, customerId, staffId, status: 'COMPLETED' },
  })
}

afterEach(async () => {
  await testPrisma.idempotencyKey.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.customerPhoto.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.recordingSession.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('photo-session linkage + upload idempotency', () => {
  it('upload carries session/staff/consent; list returns them; legacy upload untouched', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff({ userId: '99999999-0000-0000-0000-000000000041' })
    const session = await seedSession(customer.id, staff.id)

    // login-uuid identity form stores under the CARD id (house rule)
    const res = await uploadReq(customer.id, {
      category: 'after',
      recording_session_id: session.id,
      captured_by_staff_id: '99999999-0000-0000-0000-000000000041',
      taken_with_consent: 'true',
    })
    expect(res.status).toBe(200)
    const photo = await res.json()
    expect(photo.recording_session_id).toBe(session.id)
    expect(photo.captured_by_staff_id).toBe(staff.id)
    expect(photo.taken_with_consent).toBe(true)

    // legacy shape: no new fields → nulls/false
    const legacy = await (await uploadReq(customer.id, { category: 'general' })).json()
    expect(legacy.recording_session_id).toBeNull()
    expect(legacy.captured_by_staff_id).toBeNull()
    expect(legacy.taken_with_consent).toBe(false)

    const list = await (
      await app.request(`/v1/customers/${customer.id}/photos`, { headers: authHeaders })
    ).json()
    const linked = list.photos.find((p: { id: string }) => p.id === photo.id)
    expect(linked.recording_session_id).toBe(session.id)
    expect(linked.taken_with_consent).toBe(true)
  })

  it('foreign session or unknown staff 404 without storing a photo', async () => {
    const customer = await seedTestCustomer()
    const badSession = await uploadReq(customer.id, {
      recording_session_id: '00000000-0000-0000-0000-000000000077',
    })
    expect(badSession.status).toBe(404)
    const badStaff = await uploadReq(customer.id, {
      captured_by_staff_id: '00000000-0000-0000-0000-000000000078',
    })
    expect(badStaff.status).toBe(404)
    expect(
      await testPrisma.customerPhoto.count({ where: { businessId: TEST_BUSINESS_ID } }),
    ).toBe(0)
  })

  it('retried upload with the same Idempotency-Key replays the stored photo — one row total', async () => {
    const customer = await seedTestCustomer()
    const first = await uploadReq(customer.id, { category: 'before' }, 'photo-retry-1')
    expect(first.status).toBe(200)
    const created = await first.json()

    const retry = await uploadReq(customer.id, { category: 'before' }, 'photo-retry-1')
    expect(retry.status).toBe(200)
    expect((await retry.json()).id).toBe(created.id)

    expect(
      await testPrisma.customerPhoto.count({ where: { businessId: TEST_BUSINESS_ID } }),
    ).toBe(1)

    // failed upload releases the key: 404 attempt then success on retry
    const bad = await uploadReq(customer.id, {
      recording_session_id: '00000000-0000-0000-0000-000000000077',
    }, 'photo-retry-2')
    expect(bad.status).toBe(404)
    const good = await uploadReq(customer.id, {}, 'photo-retry-2')
    expect(good.status).toBe(200)
  })

  it('appointment and photo scopes never collide on the same key', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const sameKey = 'shared-key-1'

    const appt = await app.request('/v1/appointments', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', 'Idempotency-Key': sameKey },
      body: JSON.stringify({
        customer_id: customer.id,
        staff_id: staff.id,
        starts_at: '2026-09-10T01:00:00.000Z',
        ends_at: '2026-09-10T02:00:00.000Z',
      }),
    })
    expect(appt.status).toBe(201)

    const photo = await uploadReq(customer.id, {}, sameKey)
    expect(photo.status).toBe(200) // not a cross-scope replay of the appointment
    expect((await photo.json()).storage_path).toContain(customer.id)
  })
})
