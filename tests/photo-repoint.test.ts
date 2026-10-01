// CORE-16: re-pointing a karute to another customer must move its session
// photos too, or the old customer keeps seeing another person's photos.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

// storageGate.hold pauses an upload between its session check and its insert.
const storageGate = vi.hoisted(() => ({ hold: null as Promise<void> | null, reached: () => {}, removed: [] as string[], onRemove: null as null | (() => Promise<void>) }))
vi.mock('../src/services/storage.js', () => ({
  getStorage: vi.fn(() => ({
    from: vi.fn(() => ({
      upload: vi.fn(async () => {
        if (storageGate.hold) { storageGate.reached(); await storageGate.hold }
        return { error: null }
      }),
      remove: vi.fn(async (paths: string[]) => { storageGate.removed.push(...paths); await storageGate.onRemove?.(); return { error: null } }),
      createSignedUrl: vi.fn(() => ({ data: { signedUrl: 'https://fake/signed' } })),
    })),
  })),
}))
// Bearer token = the auth user id (same stub as recording-actor-authorization).
vi.mock('../src/services/supabase-auth.service.js', () => ({
  verifySupabaseAccessToken: vi.fn(async (token: string) => token),
}))

import app from '../src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const OTHER_BUSINESS_ID = '00000000-0000-0000-0000-000000000002'
const STAFF_USER_ID = '90000000-0000-0000-0000-000000000161'
const ASSISTANT_USER_ID = '90000000-0000-0000-0000-000000000162'
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'Content-Type': 'application/json' }
const repoint = (karuteId: string, body: unknown, token: string | null = STAFF_USER_ID) =>
  app.request(`/v1/karute-records/${karuteId}/photos/repoint`, {
    method: 'POST',
    headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
    body: JSON.stringify(body),
  })
const upload = (customerId: string, recordingSessionId: string) => {
  const fd = new FormData()
  fd.append('file', new File(['x'], 'p.jpg', { type: 'image/jpeg' }))
  fd.append('recording_session_id', recordingSessionId)
  return app.request(`/v1/customers/${customerId}/photos`, {
    method: 'POST', headers: { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID }, body: fd,
  })
}
const repointAudits = () => testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID, action: 'karute.photos_repoint' } })
const listPhotos = async (customerId: string) =>
  (await (await app.request(`/v1/customers/${customerId}/photos`, { headers })).json()).photos as { id: string }[]

afterEach(async () => {
  storageGate.hold = null
  storageGate.removed.length = 0
  storageGate.onRemove = null
  await testPrisma.$executeRawUnsafe(
    `DO $$ BEGIN
       PERFORM set_config('app.audit_scrub', 'on', true);
       DELETE FROM audit_log WHERE business_id = '${TEST_BUSINESS_ID}';
     END $$`,
  )
  await testPrisma.customerPhoto.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, OTHER_BUSINESS_ID] } } })
  await testPrisma.karuteRecord.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, OTHER_BUSINESS_ID] } } })
  await testPrisma.recordingSession.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.customer.deleteMany({ where: { businessId: OTHER_BUSINESS_ID } })
  await cleanupTestData()
})

/** A karute already re-pointed from `from` to `to`, whose session photos
 *  (two live, one soft-deleted) still sit on `from`, plus one unrelated photo
 *  and one other-business photo that wrongly carries the same session id. */
async function seed() {
  const staff = await seedTestStaff({ userId: STAFF_USER_ID, role: 'STYLIST' })
  const from = await seedTestCustomer({ name: '旧', email: 'old@example.com', phone: null })
  const to = await seedTestCustomer({ name: '新', email: 'new@example.com', phone: null })
  const session = await testPrisma.recordingSession.create({
    data: { businessId: TEST_BUSINESS_ID, customerId: from.id, staffId: staff.id, status: 'COMPLETED' },
  })
  const karute = await testPrisma.karuteRecord.create({
    data: { businessId: TEST_BUSINESS_ID, customerId: to.id, staffId: staff.id, recordingSessionId: session.id },
  })
  const photo = (extra: Record<string, unknown> = {}) =>
    testPrisma.customerPhoto.create({
      data: { businessId: TEST_BUSINESS_ID, customerId: from.id, storagePath: `p/${Math.random()}.jpg`, recordingSessionId: session.id, ...extra },
    })
  const live = [await photo(), await photo()]
  const deleted = await photo({ deletedAt: new Date() })
  const unrelated = await photo({ recordingSessionId: null })
  const foreignCustomer = await testPrisma.customer.create({ data: { businessId: OTHER_BUSINESS_ID, name: '他社' } })
  const foreignPhoto = await photo({ businessId: OTHER_BUSINESS_ID, customerId: foreignCustomer.id })
  return { staff, from, to, session, karute, live, deleted, unrelated, foreignCustomer, foreignPhoto }
}

describe('POST /karute-records/:id/photos/repoint', () => {
  it('moves every session photo (soft-deleted too) to the karute customer and leaves the rest', async () => {
    const s = await seed()
    const res = await repoint(s.karute.id, { customer_id: s.to.id })
    expect(res.status).toBe(200)
    expect((await res.json()).moved_count).toBe(3)

    expect((await listPhotos(s.from.id)).map(p => p.id)).toEqual([s.unrelated.id])
    expect((await listPhotos(s.to.id)).map(p => p.id).sort()).toEqual(s.live.map(p => p.id).sort())
    const deleted = await testPrisma.customerPhoto.findUnique({ where: { id: s.deleted.id } })
    expect(deleted!.customerId).toBe(s.to.id)
    expect(deleted!.recordingSessionId).toBe(s.session.id) // session linkage kept
    // Another business's row is never touched, even with the same session id.
    expect((await testPrisma.customerPhoto.findUnique({ where: { id: s.foreignPhoto.id } }))!.customerId).toBe(s.foreignCustomer.id)
  })

  it('moves the recording session too: new customer may add session photos, old one may not', async () => {
    const s = await seed()
    await repoint(s.karute.id, { customer_id: s.to.id })
    expect((await testPrisma.recordingSession.findUnique({ where: { id: s.session.id } }))!.customerId).toBe(s.to.id)
    expect((await upload(s.to.id, s.session.id)).status).toBe(200)
    expect((await upload(s.from.id, s.session.id)).status).toBe(409)
  })

  it('an old-customer upload that passed the session check before a repoint cannot land on the old customer', async () => {
    const s = await seed()
    let release!: () => void
    const reached = new Promise<void>(r => { storageGate.reached = r })
    storageGate.hold = new Promise<void>(r => { release = r })
    const pending = upload(s.from.id, s.session.id) // passes the first check, then waits in storage
    await reached
    expect((await repoint(s.karute.id, { customer_id: s.to.id })).status).toBe(200)
    // The remove runs after the upload's transaction ends (its share lock is
    // gone), and a remove that throws does not replace the 409.
    let lockFreeAtRemove = false
    storageGate.onRemove = async () => {
      await testPrisma.$transaction(tx => tx.$queryRaw`SELECT 1 FROM recording_sessions WHERE id = ${s.session.id}::uuid FOR UPDATE NOWAIT`)
      lockFreeAtRemove = true
      throw new Error('storage down')
    }
    storageGate.hold = null
    release()
    const res = await pending
    expect(res.status).toBe(409)
    expect(await testPrisma.customerPhoto.count({ where: { recordingSessionId: s.session.id, customerId: s.from.id } })).toBe(0)
    expect(storageGate.removed).toHaveLength(1) // the orphan file is cleaned up
    expect(storageGate.removed[0]).toContain(s.from.id)
    expect(lockFreeAtRemove).toBe(true)
  })

  it('a session photo committed while the repoint waits on the session lock is moved too', async () => {
    const s = await seed()
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const photoId = randomUUID()
    // Stand-in for an upload inside its insert transaction: it holds FOR SHARE.
    const uploadTx = testPrisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM recording_sessions WHERE id = ${s.session.id}::uuid FOR SHARE`
      await tx.customerPhoto.create({ data: { id: photoId, businessId: TEST_BUSINESS_ID, customerId: s.from.id, storagePath: 'p/late.jpg', recordingSessionId: s.session.id } })
      await gate
    }, { timeout: 20000 })
    await new Promise(r => setTimeout(r, 50))
    const pending = repoint(s.karute.id, { customer_id: s.to.id })
    // Wait until the repoint blocks on the session row lock.
    for (let i = 0; i < 200; i++) {
      const [{ n }] = await testPrisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`
      if (n > 0n) break
      await new Promise(r => setTimeout(r, 25))
    }
    release()
    await uploadTx
    expect((await (await pending).json()).moved_count).toBe(4)
    expect((await testPrisma.customerPhoto.findUnique({ where: { id: photoId } }))!.customerId).toBe(s.to.id)
  })

  it('writes one audit row naming the karute, both customers and the actor', async () => {
    const s = await seed()
    await repoint(s.karute.id, { customer_id: s.to.id })
    const rows = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID, action: 'karute.photos_repoint' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ category: 'karute', targetType: 'karute', targetId: s.karute.id, actorType: 'staff', actorId: s.staff.id, actorStaffRef: s.staff.id })
    expect(rows[0].detail).not.toHaveProperty('truncated')
    expect(rows[0].requestId).toBeTruthy()
    const detail = rows[0].detail as { from_customer_ids: string[]; to_customer_id: string; recording_session_id: string; photo_count: number; photo_ids: string[] }
    expect(detail.from_customer_ids).toEqual([s.from.id])
    expect(detail.to_customer_id).toBe(s.to.id)
    expect(detail.recording_session_id).toBe(s.session.id)
    expect(detail.photo_count).toBe(3)
    expect(detail.photo_ids.sort()).toEqual([...s.live, s.deleted].map(p => p.id).sort())
  })

  it('keeps the customer ids in the audit detail for a large session', async () => {
    const s = await seed()
    const ids = Array.from({ length: 200 }, () => randomUUID())
    await testPrisma.customerPhoto.createMany({
      data: ids.map(id => ({ id, businessId: TEST_BUSINESS_ID, customerId: s.from.id, storagePath: `p/${id}.jpg`, recordingSessionId: s.session.id })),
    })
    expect((await (await repoint(s.karute.id, { customer_id: s.to.id })).json()).moved_count).toBe(203)
    const [row] = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID, action: 'karute.photos_repoint' } })
    expect(row.detail).toMatchObject({ from_customer_ids: [s.from.id], to_customer_id: s.to.id, photo_count: 203 })
  })

  it('is idempotent: a retry moves nothing, still succeeds, and writes no second audit row', async () => {
    const s = await seed()
    await repoint(s.karute.id, { customer_id: s.to.id })
    const again = await repoint(s.karute.id, { customer_id: s.to.id })
    expect(again.status).toBe(200)
    expect((await again.json()).moved_count).toBe(0)
    expect(await repointAudits()).toBe(1)
  })

  it('refuses a partial photo list: the whole session always moves together', async () => {
    const s = await seed()
    expect((await repoint(s.karute.id, { customer_id: s.to.id, photo_ids: [s.live[0].id] })).status).toBe(400)
    expect(await testPrisma.customerPhoto.count({ where: { customerId: s.to.id } })).toBe(0)
  })

  it('refuses a target customer in another business with 404 and changes nothing', async () => {
    const s = await seed()
    await testPrisma.karuteRecord.update({ where: { id: s.karute.id }, data: { customerId: s.foreignCustomer.id } })
    const res = await repoint(s.karute.id, { customer_id: s.foreignCustomer.id })
    expect(res.status).toBe(404)
    expect(await testPrisma.customerPhoto.count({ where: { customerId: s.from.id } })).toBe(4)
    expect(await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it('404s a karute in another business and moves nothing', async () => {
    const s = await seed()
    await testPrisma.karuteRecord.update({ where: { id: s.karute.id }, data: { businessId: OTHER_BUSINESS_ID } })
    expect((await repoint(s.karute.id, { customer_id: s.to.id })).status).toBe(404)
    expect(await testPrisma.customerPhoto.count({ where: { customerId: s.from.id } })).toBe(4)
    expect(await repointAudits()).toBe(0)
  })

  it('refuses a target that is not the karute customer with 409 and moves nothing', async () => {
    const s = await seed()
    expect((await repoint(s.karute.id, { customer_id: s.from.id })).status).toBe(409)
    expect(await testPrisma.customerPhoto.count({ where: { customerId: s.to.id } })).toBe(0)
    expect((await testPrisma.recordingSession.findUnique({ where: { id: s.session.id } }))!.customerId).toBe(s.from.id)
    expect(await repointAudits()).toBe(0)
  })

  it('takes the actor from the bearer token and needs records.write', async () => {
    const s = await seed()
    await seedTestStaff({ name: '受付', userId: ASSISTANT_USER_ID, role: 'ASSISTANT' })
    expect((await repoint(s.karute.id, { customer_id: s.to.id }, null)).status).toBe(401)
    expect((await repoint(s.karute.id, { customer_id: s.to.id }, ASSISTANT_USER_ID)).status).toBe(403)
    expect(await testPrisma.customerPhoto.count({ where: { customerId: s.to.id } })).toBe(0)
    expect(await repointAudits()).toBe(0)
    // A body actor is not part of the contract.
    expect((await repoint(s.karute.id, { customer_id: s.to.id, actor_staff_id: s.staff.id })).status).toBe(400)
  })

  it('404s a missing karute and 400s a bad body', async () => {
    const s = await seed()
    expect((await repoint('00000000-0000-0000-0000-00000000dead', { customer_id: s.to.id })).status).toBe(404)
    expect((await repoint(s.karute.id, {})).status).toBe(400)
  })
})
