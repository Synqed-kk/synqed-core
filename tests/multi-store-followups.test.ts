import { describe, it, expect, afterEach } from 'vitest'
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

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

afterEach(async () => {
  await cleanupTestData()
})

describe('multi-store follow-ups', () => {
  it('filters the appointment list by store_id', async () => {
    const cust = await seedTestCustomer()
    const staff = await seedTestStaff()
    const mk = (storeId: string, h: number) => testPrisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID, customerId: cust.id, staffId: staff.id, storeId,
        startsAt: new Date(`2026-10-01T0${h}:00:00Z`), endsAt: new Date(`2026-10-01T0${h + 1}:00:00Z`),
        status: 'SCHEDULED', source: 'MANUAL',
      },
    })
    await mk(A, 1)
    await mk(B, 3)

    const scoped = await (await req('GET', `/appointments?store_id=${A}&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z`)).json()
    expect(scoped.appointments.length).toBe(1)
    expect(scoped.appointments[0].store_id).toBe(A)

    const all = await (await req('GET', '/appointments?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z')).json()
    expect(all.appointments.length).toBe(2)
  })

  it('backfills unassigned event rows to the primary store, scoped to the business, idempotently', async () => {
    const cust = await seedTestCustomer()
    const staff = await seedTestStaff()
    // one unassigned appointment + one already-assigned to B
    await testPrisma.appointment.create({ data: { businessId: TEST_BUSINESS_ID, customerId: cust.id, staffId: staff.id, startsAt: new Date('2026-10-05T01:00:00Z'), endsAt: new Date('2026-10-05T02:00:00Z'), status: 'SCHEDULED', source: 'MANUAL' } })
    await testPrisma.appointment.create({ data: { businessId: TEST_BUSINESS_ID, customerId: cust.id, staffId: staff.id, storeId: B, startsAt: new Date('2026-10-05T03:00:00Z'), endsAt: new Date('2026-10-05T04:00:00Z'), status: 'SCHEDULED', source: 'MANUAL' } })
    await testPrisma.customerVisit.create({ data: { businessId: TEST_BUSINESS_ID, customerId: cust.id, qrReservationId: 9500, usedAt: new Date('2026-05-01T01:00:00Z'), status: 'settled' } })

    const res = await req('POST', '/admin/backfill-store', { store_id: A })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.appointments).toBe(1) // only the unassigned one
    expect(body.visits).toBe(1)

    // the already-assigned B appointment is untouched
    const bAppt = await testPrisma.appointment.count({ where: { businessId: TEST_BUSINESS_ID, storeId: B } })
    expect(bAppt).toBe(1)

    // idempotent: second run touches nothing
    const again = await (await req('POST', '/admin/backfill-store', { store_id: A })).json()
    expect(again.appointments).toBe(0)
    expect(again.visits).toBe(0)
  })

  it('rejects backfill with a non-uuid store_id', async () => {
    const res = await req('POST', '/admin/backfill-store', { store_id: 'not-a-uuid' })
    expect(res.status).toBe(400)
  })
})
