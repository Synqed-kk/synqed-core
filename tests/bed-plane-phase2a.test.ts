import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestStaff,
  testPrisma,
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
async function seedStore(name = '店') {
  return testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name } })
}

afterEach(async () => {
  await testPrisma.$executeRawUnsafe(
    `DO $$ BEGIN
       PERFORM set_config('app.audit_scrub', 'on', true);
       DELETE FROM audit_log WHERE business_id = '${TEST_BUSINESS_ID}';
     END $$`,
  )
  await testPrisma.storeClosedDay.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.storeBookingPolicy.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.staffQualification.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.qualification.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.businessGrant.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('weekly opening hours (item 5)', () => {
  it('round-trips weekly_hours; null weekday = 定休日; null value clears', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const store = await seedStore()

    const hours = { mon: { open: '10:00', close: '20:00' }, tue: null }
    const set = await req('PUT', `/store-policies/${store.id}`, {
      weekly_hours: hours,
      acting_staff_id: owner.id,
    })
    expect(set.status).toBe(200)
    expect((await set.json()).weekly_hours).toEqual(hours)

    // Reads carry it; other fields keep defaults.
    const read = await (await req('GET', `/store-policies/${store.id}`)).json()
    expect(read.weekly_hours).toEqual(hours)
    expect(read.booking_open_days).toBe(30)

    // Explicit null clears the column back to unconfigured.
    const cleared = await req('PUT', `/store-policies/${store.id}`, {
      weekly_hours: null,
      acting_staff_id: owner.id,
    })
    expect((await cleared.json()).weekly_hours).toBeNull()
  })

  it('rejects a malformed window (open after close, bad time strings)', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const store = await seedStore()
    const inverted = await req('PUT', `/store-policies/${store.id}`, {
      weekly_hours: { mon: { open: '20:00', close: '10:00' } },
      acting_staff_id: owner.id,
    })
    expect(inverted.status).toBe(400)
    const garbage = await req('PUT', `/store-policies/${store.id}`, {
      weekly_hours: { mon: { open: '25:00', close: '26:00' } },
      acting_staff_id: owner.id,
    })
    expect(garbage.status).toBe(400)
  })
})

describe('ad-hoc closed days (item 5)', () => {
  it('add / list / range-filter / remove; duplicate date 409s; HQ-gated', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const stylist = await seedTestStaff({ name: '一般', role: 'STYLIST' })
    const store = await seedStore()

    const denied = await req('POST', `/store-policies/${store.id}/closed-days`, {
      date: '2026-09-15',
      acting_staff_id: stylist.id,
    })
    expect(denied.status).toBe(403)

    const added = await req('POST', `/store-policies/${store.id}/closed-days`, {
      date: '2026-09-15',
      reason: '臨時休業',
      acting_staff_id: owner.id,
    })
    expect(added.status).toBe(201)
    const day = await added.json()
    expect(day.date).toBe('2026-09-15')
    expect(day.reason).toBe('臨時休業')
    expect(day.created_by).toBe(owner.id)

    const dup = await req('POST', `/store-policies/${store.id}/closed-days`, {
      date: '2026-09-15',
      acting_staff_id: owner.id,
    })
    expect(dup.status).toBe(409)

    await req('POST', `/store-policies/${store.id}/closed-days`, {
      date: '2026-10-01',
      acting_staff_id: owner.id,
    })
    const all = await (await req('GET', `/store-policies/${store.id}/closed-days`)).json()
    expect(all.closed_days).toHaveLength(2)
    const sept = await (
      await req('GET', `/store-policies/${store.id}/closed-days?from=2026-09-01&to=2026-10-01`)
    ).json()
    expect(sept.closed_days).toHaveLength(1)
    expect(sept.closed_days[0].date).toBe('2026-09-15')

    const removed = await req(
      'DELETE',
      `/store-policies/${store.id}/closed-days/${day.id}?acting_staff_id=${owner.id}`,
    )
    expect(removed.status).toBe(200)
    const after = await (await req('GET', `/store-policies/${store.id}/closed-days`)).json()
    expect(after.closed_days).toHaveLength(1)
  })

  it('404s for an unknown store', async () => {
    const res = await req('GET', '/store-policies/00000000-0000-0000-0000-000000000099/closed-days')
    expect(res.status).toBe(404)
  })
})

describe('qualifications (item 7)', () => {
  it('create / list / rename / retire; duplicate name 409s', async () => {
    const created = await req('POST', '/qualifications', { name: 'アートメイク認定' })
    expect(created.status).toBe(201)
    const q = await created.json()

    const dup = await req('POST', '/qualifications', { name: 'アートメイク認定' })
    expect(dup.status).toBe(409)

    const renamed = await (
      await req('PATCH', `/qualifications/${q.id}`, { name: '上級認定' })
    ).json()
    expect(renamed.name).toBe('上級認定')

    await req('PATCH', `/qualifications/${q.id}`, { active: false })
    const activeOnly = await (await req('GET', '/qualifications?active=true')).json()
    expect(activeOnly.qualifications).toHaveLength(0)
    const all = await (await req('GET', '/qualifications')).json()
    expect(all.qualifications).toHaveLength(1)
  })

  it('staff set is replace-the-set; bulk read keys by staff', async () => {
    const staff = await seedTestStaff()
    const q1 = await (await req('POST', '/qualifications', { name: 'A' })).json()
    const q2 = await (await req('POST', '/qualifications', { name: 'B' })).json()

    await req('PUT', `/qualifications/staff/${staff.id}`, { qualification_ids: [q1.id, q2.id] })
    let ids = await (await req('GET', `/qualifications/staff/${staff.id}`)).json()
    expect(ids.qualification_ids.sort()).toEqual([q1.id, q2.id].sort())

    await req('PUT', `/qualifications/staff/${staff.id}`, { qualification_ids: [q2.id] })
    ids = await (await req('GET', `/qualifications/staff/${staff.id}`)).json()
    expect(ids.qualification_ids).toEqual([q2.id])

    const bulk = await (await req('GET', '/qualifications/staff')).json()
    expect(bulk.assignments[staff.id]).toEqual([q2.id])
  })

  it('rejects linking a qualification from outside the business', async () => {
    const staff = await seedTestStaff()
    const res = await req('PUT', `/qualifications/staff/${staff.id}`, {
      qualification_ids: ['00000000-0000-0000-0000-0000000000aa'],
    })
    expect(res.status).toBe(400)
  })

  it('menu link: valid id round-trips, unknown id 404s, null clears', async () => {
    const q = await (await req('POST', '/qualifications', { name: '認定' })).json()
    const created = await req('POST', '/menus', {
      name: 'コース',
      duration_minutes: 60,
      price_list_amount: 10000,
      required_qualification_id: q.id,
    })
    expect(created.status).toBe(201)
    const menu = await created.json()
    expect(menu.required_qualification_id).toBe(q.id)

    const bad = await req('POST', '/menus', {
      name: 'コース2',
      duration_minutes: 60,
      price_list_amount: 10000,
      required_qualification_id: '00000000-0000-0000-0000-0000000000aa',
    })
    expect(bad.status).toBe(404)

    const cleared = await (
      await req('PATCH', `/menus/${menu.id}`, { required_qualification_id: null })
    ).json()
    expect(cleared.required_qualification_id).toBeNull()
  })
})
