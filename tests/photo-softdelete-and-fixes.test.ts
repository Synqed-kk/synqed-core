import { describe, it, expect, afterEach, vi } from 'vitest'

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
import { cleanupTestData, seedTestCustomer, seedTestStaff, seedTestKaruteRecord, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const authHeaders = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID }
const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' }
function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: jsonHeaders }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}
function uploadReq(customerId: string, fields: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('file', new File(['x'], 'p.jpg', { type: 'image/jpeg' }))
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return app.request(`/v1/customers/${customerId}/photos`, { method: 'POST', headers: authHeaders, body: fd })
}

afterEach(async () => {
  await testPrisma.idempotencyKey.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.customerPhoto.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.recordingSession.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.karuteEntryEdit.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('photo soft delete + restore', () => {
  it('delete hides from list but keeps the row + storage path; restore brings it back', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const photo = await (await uploadReq(customer.id)).json()

    const del = await req('DELETE', `/customers/${customer.id}/photos/${photo.id}?deleted_by=${staff.id}`)
    expect(del.status).toBe(200)

    const list = await (await app.request(`/v1/customers/${customer.id}/photos`, { headers: authHeaders })).json()
    expect(list.photos).toHaveLength(0)

    const row = await testPrisma.customerPhoto.findUnique({ where: { id: photo.id } })
    expect(row).not.toBeNull() // never truly gone
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.deletedBy).toBe(staff.id)
    expect(row!.storagePath).toBe(photo.storage_path) // storage untouched

    // double-delete of an already-deleted photo 404s
    expect((await req('DELETE', `/customers/${customer.id}/photos/${photo.id}`)).status).toBe(404)

    const restored = await (await req('POST', `/customers/${customer.id}/photos/${photo.id}/restore`)).json()
    expect(restored.id).toBe(photo.id)
    const after = await (await app.request(`/v1/customers/${customer.id}/photos`, { headers: authHeaders })).json()
    expect(after.photos).toHaveLength(1)
  })
})

describe('session↔customer validation on upload', () => {
  it("rejects a session belonging to a different customer; allows customerless sessions", async () => {
    const staff = await seedTestStaff()
    const c1 = await seedTestCustomer()
    const c2 = await seedTestCustomer({ email: 'other@ex.com' })
    const owned = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id, customerId: c1.id, status: 'COMPLETED' },
    })
    const free = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id, status: 'COMPLETED' },
    })

    const cross = await uploadReq(c2.id, { recording_session_id: owned.id })
    expect(cross.status).toBe(409)
    expect(await testPrisma.customerPhoto.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)

    expect((await uploadReq(c1.id, { recording_session_id: owned.id })).status).toBe(200)
    expect((await uploadReq(c2.id, { recording_session_id: free.id })).status).toBe(200)
  })
})

describe('entry-edit id is returned from all three entry mutations', () => {
  it('add, update, delete each hand back the exact entry_edits row id', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const rec = await seedTestKaruteRecord({ staffId: staff.id, customerId: customer.id })

    const added = await (
      await req('POST', `/karute-records/${rec.id}/entries`, {
        category: 'SYMPTOM', content: '肩こり', is_manual: true,
      })
    ).json()
    expect(added.entry_edit_id).toBeTruthy()
    const addEdit = await testPrisma.karuteEntryEdit.findUnique({ where: { id: added.entry_edit_id } })
    expect(addEdit?.action).toBe('CREATE')

    const updated = await (
      await req('PATCH', `/karute-records/${rec.id}/entries/${added.id}`, {
        content: '肩こり(修正)', expected_version: added.version,
      })
    ).json()
    expect(updated.entry_edit_id).toBeTruthy()
    expect(updated.entry_edit_id).not.toBe(added.entry_edit_id)

    const deleted = await (
      await req('DELETE', `/karute-records/${rec.id}/entries/${added.id}`)
    ).json()
    expect(deleted.entry_edit_id).toBeTruthy()
    const delEdit = await testPrisma.karuteEntryEdit.findUnique({ where: { id: deleted.entry_edit_id } })
    expect(delEdit?.action).toBe('DELETE')
  })
})

describe('walk-in pack burn dedup (scope: pack)', () => {
  it('same key replays the burn — one redemption row even with NULL appointment_id', async () => {
    const customer = await seedTestCustomer()
    const pack = await (
      await req('POST', '/packs', { customer_id: customer.id, kind: '回数券', pack_size: 10, unit_price: 5000 })
    ).json()

    const burn = (key?: string) => app.request('/v1/packs/redemptions', {
      method: 'POST',
      headers: { ...jsonHeaders, ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify({ pack_id: pack.id, customer_id: customer.id, redeemed_on: '2026-08-17' }),
    })

    const first = await burn('walkin-1')
    expect(first.status).toBe(201)
    const { id } = await first.json()
    const retry = await burn('walkin-1')
    expect(retry.status).toBe(200)
    expect((await retry.json()).id).toBe(id)
    expect(await testPrisma.packRedemption.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(1)

    // different key = genuinely second walk-in burn — allowed
    expect((await burn('walkin-2')).status).toBe(201)
  })
})
