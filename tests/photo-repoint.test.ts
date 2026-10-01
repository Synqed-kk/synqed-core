// CORE-16: re-pointing a karute to another customer must move its session
// photos too, or the old customer keeps seeing another person's photos.
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('../src/services/storage.js', () => ({
  getStorage: vi.fn(() => ({
    from: vi.fn(() => ({
      createSignedUrl: vi.fn(() => ({ data: { signedUrl: 'https://fake/signed' } })),
    })),
  })),
}))

import app from '../src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const OTHER_BUSINESS_ID = '00000000-0000-0000-0000-000000000002'
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'Content-Type': 'application/json' }
const repoint = (karuteId: string, body: unknown) =>
  app.request(`/v1/karute-records/${karuteId}/photos/repoint`, { method: 'POST', headers, body: JSON.stringify(body) })
const listPhotos = async (customerId: string) =>
  (await (await app.request(`/v1/customers/${customerId}/photos`, { headers })).json()).photos as { id: string }[]

afterEach(async () => {
  await testPrisma.$executeRawUnsafe(
    `DO $$ BEGIN
       PERFORM set_config('app.audit_scrub', 'on', true);
       DELETE FROM audit_log WHERE business_id = '${TEST_BUSINESS_ID}';
     END $$`,
  )
  await testPrisma.customerPhoto.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.karuteRecord.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.recordingSession.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.customer.deleteMany({ where: { businessId: OTHER_BUSINESS_ID } })
  await cleanupTestData()
})

/** A karute already re-pointed from `from` to `to`, whose session photos
 *  (two live, one soft-deleted) still sit on `from`, plus one unrelated photo. */
async function seed() {
  const staff = await seedTestStaff()
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
  return { staff, from, to, session, karute, live, deleted, unrelated }
}

describe('POST /karute-records/:id/photos/repoint', () => {
  it('moves every session photo (soft-deleted too) to the karute customer and leaves the rest', async () => {
    const s = await seed()
    const res = await repoint(s.karute.id, { customer_id: s.to.id, actor_staff_id: s.staff.id })
    expect(res.status).toBe(200)
    expect((await res.json()).moved_count).toBe(3)

    expect((await listPhotos(s.from.id)).map(p => p.id)).toEqual([s.unrelated.id])
    expect((await listPhotos(s.to.id)).map(p => p.id).sort()).toEqual(s.live.map(p => p.id).sort())
    const deleted = await testPrisma.customerPhoto.findUnique({ where: { id: s.deleted.id } })
    expect(deleted!.customerId).toBe(s.to.id)
    expect(deleted!.recordingSessionId).toBe(s.session.id) // session linkage kept
  })

  it('writes one audit row naming the karute, both customers and the actor', async () => {
    const s = await seed()
    await repoint(s.karute.id, { customer_id: s.to.id, actor_staff_id: s.staff.id })
    const rows = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID, action: 'karute.photos_repoint' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ category: 'karute', targetType: 'karute', targetId: s.karute.id, actorType: 'staff', actorId: s.staff.id, actorStaffRef: s.staff.id })
    expect(rows[0].requestId).toBeTruthy()
    const detail = rows[0].detail as { from_customer_ids: string[]; to_customer_id: string; photo_ids: string[] }
    expect(detail.from_customer_ids).toEqual([s.from.id])
    expect(detail.to_customer_id).toBe(s.to.id)
    expect(detail.photo_ids.sort()).toEqual([...s.live, s.deleted].map(p => p.id).sort())
  })

  it('is idempotent: a retry moves nothing, still succeeds, and writes no second audit row', async () => {
    const s = await seed()
    await repoint(s.karute.id, { customer_id: s.to.id, actor_staff_id: s.staff.id })
    const again = await repoint(s.karute.id, { customer_id: s.to.id, actor_staff_id: s.staff.id })
    expect(again.status).toBe(200)
    expect((await again.json()).moved_count).toBe(0)
    expect(await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID, action: 'karute.photos_repoint' } })).toBe(1)
  })

  it('moves only the listed photos when photo_ids is given', async () => {
    const s = await seed()
    const res = await repoint(s.karute.id, { customer_id: s.to.id, actor_staff_id: s.staff.id, photo_ids: [s.live[0].id, s.unrelated.id] })
    expect((await res.json()).moved_count).toBe(1) // the unrelated photo is not this karute's
    expect((await listPhotos(s.to.id)).map(p => p.id)).toEqual([s.live[0].id])
  })

  it('refuses a target customer in another business with 404 and changes nothing', async () => {
    const s = await seed()
    const foreign = await testPrisma.customer.create({ data: { businessId: OTHER_BUSINESS_ID, name: '他社' } })
    await testPrisma.karuteRecord.update({ where: { id: s.karute.id }, data: { customerId: foreign.id } })
    const res = await repoint(s.karute.id, { customer_id: foreign.id, actor_staff_id: s.staff.id })
    expect(res.status).toBe(404)
    expect(await testPrisma.customerPhoto.count({ where: { customerId: s.from.id } })).toBe(4)
    expect(await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it('refuses a target that is not the karute customer with 409', async () => {
    const s = await seed()
    const res = await repoint(s.karute.id, { customer_id: s.from.id, actor_staff_id: s.staff.id })
    expect(res.status).toBe(409)
  })

  it('404s a missing karute and 400s a bad body or unknown actor', async () => {
    const s = await seed()
    expect((await repoint('00000000-0000-0000-0000-00000000dead', { customer_id: s.to.id, actor_staff_id: s.staff.id })).status).toBe(404)
    expect((await repoint(s.karute.id, { customer_id: s.to.id })).status).toBe(400)
    expect((await repoint(s.karute.id, { customer_id: s.to.id, actor_staff_id: s.to.id })).status).toBe(400)
  })
})
