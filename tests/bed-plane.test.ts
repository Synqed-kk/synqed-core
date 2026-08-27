import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

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

let seq = 0
async function pair() {
  const staff = await seedTestStaff()
  const customer = await seedTestCustomer({ email: `bed-${++seq}@ex.com` })
  return { staff, customer }
}

afterEach(async () => {
  await testPrisma.appointment.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.resource.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('resources CRUD', () => {
  it('create/list/update; retire via active:false; no DELETE route; foreign store 400', async () => {
    const store = await seedStore()
    const bed = await (
      await req('POST', '/resources', {
        store_id: store.id, name: 'ベッド1', room_class: 'private', cleanup_minutes: 15,
      })
    ).json()
    expect(bed.room_class).toBe('private')
    expect(bed.cleanup_minutes).toBe(15)

    const list = await (await req('GET', `/resources?store_id=${store.id}`)).json()
    expect(list.resources).toHaveLength(1)

    const retired = await (await req('PATCH', `/resources/${bed.id}`, { active: false })).json()
    expect(retired.active).toBe(false)
    const activeOnly = await (await req('GET', `/resources?active=true`)).json()
    expect(activeOnly.resources).toHaveLength(0)

    expect((await req('DELETE', `/resources/${bed.id}`)).status).toBe(404) // no route

    const foreign = await req('POST', '/resources', {
      store_id: '00000000-0000-0000-0000-000000000099', name: 'X',
    })
    expect(foreign.status).toBe(400)
  })
})

describe('the no-double-bed constraint', () => {
  it('two therapists cannot share one bed at one time — RESOURCE_TAKEN, distinct from the staff 409', async () => {
    const store = await seedStore()
    const bed = await (
      await req('POST', '/resources', { store_id: store.id, name: 'B1' })
    ).json()
    const a = await pair()
    const b = await pair()

    const first = await req('POST', '/appointments', {
      customer_id: a.customer.id, staff_id: a.staff.id, store_id: store.id,
      starts_at: '2026-09-20T01:00:00.000Z', ends_at: '2026-09-20T02:00:00.000Z',
      resource_id: bed.id,
    })
    expect(first.status).toBe(201)
    const created = await first.json()
    expect(created.resource_id).toBe(bed.id)
    expect(created.occupied_until).toBe('2026-09-20T02:00:00.000Z') // cleanup 0

    // DIFFERENT staff, same bed, overlapping time — the advisory lock can't
    // catch this (keys per staff); the EXCLUDE must.
    const clash = await req('POST', '/appointments', {
      customer_id: b.customer.id, staff_id: b.staff.id, store_id: store.id,
      starts_at: '2026-09-20T01:30:00.000Z', ends_at: '2026-09-20T02:30:00.000Z',
      resource_id: bed.id,
    })
    expect(clash.status).toBe(409)
    expect((await clash.json()).code).toBe('RESOURCE_TAKEN')

    // same times, different bed → fine
    const bed2 = await (await req('POST', '/resources', { store_id: store.id, name: 'B2' })).json()
    const ok = await req('POST', '/appointments', {
      customer_id: b.customer.id, staff_id: b.staff.id, store_id: store.id,
      starts_at: '2026-09-20T01:30:00.000Z', ends_at: '2026-09-20T02:30:00.000Z',
      resource_id: bed2.id,
    })
    expect(ok.status).toBe(201)
  })

  it('cleanup_minutes extends occupancy; cancelling frees the bed; revive re-checks', async () => {
    const store = await seedStore()
    const bed = await (
      await req('POST', '/resources', { store_id: store.id, name: 'B1', cleanup_minutes: 30 })
    ).json()
    const a = await pair()
    const b = await pair()

    const first = await (
      await req('POST', '/appointments', {
        customer_id: a.customer.id, staff_id: a.staff.id, store_id: store.id,
        starts_at: '2026-09-21T01:00:00.000Z', ends_at: '2026-09-21T02:00:00.000Z',
        resource_id: bed.id,
      })
    ).json()
    expect(first.occupied_until).toBe('2026-09-21T02:30:00.000Z') // +30 cleanup

    // back-to-back at 02:00 lands inside the cleanup window → taken
    const inCleanup = await req('POST', '/appointments', {
      customer_id: b.customer.id, staff_id: b.staff.id, store_id: store.id,
      starts_at: '2026-09-21T02:00:00.000Z', ends_at: '2026-09-21T03:00:00.000Z',
      resource_id: bed.id,
    })
    expect(inCleanup.status).toBe(409)
    expect((await inCleanup.json()).code).toBe('RESOURCE_TAKEN')

    // cancel frees it
    await req('PUT', `/appointments/${first.id}`, { status: 'CANCELLED' })
    const afterCancel = await req('POST', '/appointments', {
      customer_id: b.customer.id, staff_id: b.staff.id, store_id: store.id,
      starts_at: '2026-09-21T02:00:00.000Z', ends_at: '2026-09-21T03:00:00.000Z',
      resource_id: bed.id,
    })
    expect(afterCancel.status).toBe(201)

    // reviving the cancelled one now conflicts on the bed
    const revive = await req('PUT', `/appointments/${first.id}`, { status: 'SCHEDULED' })
    expect(revive.status).toBe(409)
    expect((await revive.json()).code).toBe('RESOURCE_TAKEN')
  })

  it('bed change via update recomputes occupancy; null releases; store-mismatch and inactive rejected', async () => {
    const storeA = await seedStore('A')
    const storeB = await seedStore('B')
    const bedA = await (await req('POST', '/resources', { store_id: storeA.id, name: 'A1', cleanup_minutes: 10 })).json()
    const bedB = await (await req('POST', '/resources', { store_id: storeB.id, name: 'B1' })).json()
    const a = await pair()

    const appt = await (
      await req('POST', '/appointments', {
        customer_id: a.customer.id, staff_id: a.staff.id, store_id: storeA.id,
        starts_at: '2026-09-22T01:00:00.000Z', ends_at: '2026-09-22T02:00:00.000Z',
      })
    ).json()
    expect(appt.resource_id).toBeNull()

    // claim bedA on update → occupancy = ends + 10
    const claimed = await (
      await req('PUT', `/appointments/${appt.id}`, { resource_id: bedA.id })
    ).json()
    expect(claimed.resource_id).toBe(bedA.id)
    expect(claimed.occupied_until).toBe('2026-09-22T02:10:00.000Z')

    // other store's bed → 400
    const wrongStore = await req('PUT', `/appointments/${appt.id}`, { resource_id: bedB.id })
    expect(wrongStore.status).toBe(400)

    // release
    const released = await (
      await req('PUT', `/appointments/${appt.id}`, { resource_id: null })
    ).json()
    expect(released.resource_id).toBeNull()
    expect(released.occupied_until).toBeNull()

    // inactive bed rejected on claim
    await req('PATCH', `/resources/${bedA.id}`, { active: false })
    const inactive = await req('PUT', `/appointments/${appt.id}`, { resource_id: bedA.id })
    expect(inactive.status).toBe(400)
  })
})

describe('menu room class', () => {
  it('required_room_class round-trips and clears', async () => {
    const menu = await (
      await req('POST', '/menus', {
        name: '個室トリートメント', duration_minutes: 60, price_list_amount: 12000,
        required_room_class: 'private',
      })
    ).json()
    expect(menu.required_room_class).toBe('private')
    const cleared = await (
      await req('PATCH', `/menus/${menu.id}`, { required_room_class: null })
    ).json()
    expect(cleared.required_room_class).toBeNull()
  })
})
