import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { prisma } from '../src/db/client.js'
import {
  cleanupTestData,
  seedTestCustomer,
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

async function seedStoreAndBed() {
  const store = await testPrisma.store.create({
    data: { businessId: TEST_BUSINESS_ID, name: '店' },
  })
  const bed = await testPrisma.resource.create({
    data: { businessId: TEST_BUSINESS_ID, storeId: store.id, name: 'ベッド1' },
  })
  return { store, bed }
}

afterEach(async () => {
  await testPrisma.appointment.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.resource.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('block rows (bed plane item 6)', () => {
  it('a staffed customerless block books out the staff slot', async () => {
    const staff = await seedTestStaff()
    const created = await req('POST', '/appointments', {
      kind: 'BLOCK',
      staff_id: staff.id,
      starts_at: '2026-09-10T03:00:00Z',
      ends_at: '2026-09-10T04:00:00Z',
      title: '休憩',
    })
    expect(created.status).toBe(201)
    const block = await created.json()
    expect(block.kind).toBe('BLOCK')
    expect(block.customer_id).toBeNull()
    expect(block.staff_id).toBe(staff.id)

    // The block occupies staff time: a booking on the same slot 409s.
    const customer = await seedTestCustomer()
    const clash = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-09-10T03:30:00Z',
      ends_at: '2026-09-10T04:30:00Z',
    })
    expect(clash.status).toBe(409)
  })

  it('a staffless bedded block occupies the bed (RESOURCE_TAKEN for others)', async () => {
    const { store, bed } = await seedStoreAndBed()
    const created = await req('POST', '/appointments', {
      kind: 'BLOCK',
      store_id: store.id,
      resource_id: bed.id,
      starts_at: '2026-09-10T03:00:00Z',
      ends_at: '2026-09-10T04:00:00Z',
      title: 'メンテナンス',
    })
    expect(created.status).toBe(201)
    const block = await created.json()
    expect(block.staff_id).toBeNull()
    expect(block.resource_id).toBe(bed.id)

    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const clash = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      store_id: store.id,
      resource_id: bed.id,
      starts_at: '2026-09-10T03:30:00Z',
      ends_at: '2026-09-10T04:30:00Z',
    })
    expect(clash.status).toBe(409)
    expect((await clash.json()).code).toBe('RESOURCE_TAKEN')
  })

  it('validation: block+customer 400; booking missing parties 400; block holding nothing 400', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()

    const blockWithCustomer = await req('POST', '/appointments', {
      kind: 'BLOCK',
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-09-10T03:00:00Z',
      ends_at: '2026-09-10T04:00:00Z',
    })
    expect(blockWithCustomer.status).toBe(400)

    const bookingNoCustomer = await req('POST', '/appointments', {
      staff_id: staff.id,
      starts_at: '2026-09-10T03:00:00Z',
      ends_at: '2026-09-10T04:00:00Z',
    })
    expect(bookingNoCustomer.status).toBe(400)

    const emptyBlock = await req('POST', '/appointments', {
      kind: 'BLOCK',
      starts_at: '2026-09-10T03:00:00Z',
      ends_at: '2026-09-10T04:00:00Z',
    })
    expect(emptyBlock.status).toBe(400)
  })

  it('an update cannot put a customer on a block (both update paths)', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const block = await (
      await req('POST', '/appointments', {
        kind: 'BLOCK',
        staff_id: staff.id,
        starts_at: '2026-09-10T03:00:00Z',
        ends_at: '2026-09-10T04:00:00Z',
      })
    ).json()

    // Metadata path (customer_id alone doesn't touch the slot).
    const meta = await req('PUT', `/appointments/${block.id}`, { customer_id: customer.id })
    expect(meta.status).toBe(400)

    // Slot path (customer_id + a time change).
    const slot = await req('PUT', `/appointments/${block.id}`, {
      customer_id: customer.id,
      ends_at: '2026-09-10T05:00:00Z',
    })
    expect(slot.status).toBe(400)
  })

  it('cancelling a block frees the staff slot and writes its status event', async () => {
    const staff = await seedTestStaff()
    const block = await (
      await req('POST', '/appointments', {
        kind: 'BLOCK',
        staff_id: staff.id,
        starts_at: '2026-09-10T03:00:00Z',
        ends_at: '2026-09-10T04:00:00Z',
      })
    ).json()

    const cancel = await req('PUT', `/appointments/${block.id}`, {
      status: 'CANCELLED',
      acting_staff_id: staff.id,
    })
    expect(cancel.status).toBe(200)

    const events = await prisma.appointmentStatusEvent.findMany({
      where: { appointmentId: block.id },
      orderBy: { seq: 'asc' },
    })
    expect(events.map((e) => e.status)).toEqual(['SCHEDULED', 'CANCELLED'])

    const customer = await seedTestCustomer()
    const rebook = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-09-10T03:00:00Z',
      ends_at: '2026-09-10T04:00:00Z',
    })
    expect(rebook.status).toBe(201)
  })

  it('a staffless block can still be rescheduled (row-key lock path)', async () => {
    const { store, bed } = await seedStoreAndBed()
    const block = await (
      await req('POST', '/appointments', {
        kind: 'BLOCK',
        store_id: store.id,
        resource_id: bed.id,
        starts_at: '2026-09-10T03:00:00Z',
        ends_at: '2026-09-10T04:00:00Z',
      })
    ).json()

    const moved = await req('PUT', `/appointments/${block.id}`, {
      starts_at: '2026-09-10T05:00:00Z',
      ends_at: '2026-09-10T06:00:00Z',
    })
    expect(moved.status).toBe(200)
    const json = await moved.json()
    expect(json.starts_at).toBe('2026-09-10T05:00:00.000Z')
    expect(json.occupied_until).toBe('2026-09-10T06:00:00.000Z')
  })
})
