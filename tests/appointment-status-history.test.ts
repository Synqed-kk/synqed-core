import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { prisma } from '../src/db/client.js'
import { markOrphanedCancelled } from '../src/services/sync.service.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
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

async function createViaApi(overrides?: Record<string, unknown>) {
  const customer = await seedTestCustomer()
  const staff = await seedTestStaff()
  const res = await req('POST', '/appointments', {
    customer_id: customer.id,
    staff_id: staff.id,
    starts_at: '2026-09-01T03:00:00Z',
    ends_at: '2026-09-01T04:00:00Z',
    ...overrides,
  })
  expect(res.status).toBe(201)
  return { appt: await res.json(), customer, staff }
}

describe('booking status history (msg-8 item 5)', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('create writes the birth event; a staff status change appends with who/why', async () => {
    const { appt, staff } = await createViaApi()

    let res = await req('GET', `/appointments/${appt.id}/status-history`)
    expect(res.status).toBe(200)
    let { events } = await res.json()
    expect(events).toHaveLength(1)
    expect(events[0].status).toBe('SCHEDULED')
    expect(events[0].status_source).toBe('SYSTEM')
    expect(events[0].set_by).toBeNull()

    const put = await req('PUT', `/appointments/${appt.id}`, {
      status: 'CANCELLED',
      status_reason: 'advance-cancel',
      acting_staff_id: staff.id,
    })
    expect(put.status).toBe(200)

    res = await req('GET', `/appointments/${appt.id}/status-history`)
    ;({ events } = await res.json())
    expect(events).toHaveLength(2)
    // Oldest first — the stream reads in the order it happened.
    expect(events[0].status).toBe('SCHEDULED')
    expect(events[1]).toMatchObject({
      appointment_id: appt.id,
      status: 'CANCELLED',
      status_source: 'STAFF',
      set_by: staff.id,
      reason: 'advance-cancel',
    })
  })

  it('restating the current status writes NO event (change stream, not write log)', async () => {
    const { appt, staff } = await createViaApi()
    await req('PUT', `/appointments/${appt.id}`, {
      status: 'SCHEDULED',
      acting_staff_id: staff.id,
    })
    const { events } = await (await req('GET', `/appointments/${appt.id}/status-history`)).json()
    expect(events).toHaveLength(1)
  })

  it('non-status edits write no event', async () => {
    const { appt } = await createViaApi()
    await req('PUT', `/appointments/${appt.id}`, { title: 'カット' })
    const { events } = await (await req('GET', `/appointments/${appt.id}/status-history`)).json()
    expect(events).toHaveLength(1)
  })

  it('orders by seq (applied order), not created_at — racing writers can commit against their timestamps', async () => {
    const { appt } = await createViaApi()
    // Simulate the race: the LATER-applied event carries the EARLIER
    // transaction-start timestamp. created_at ordering would reverse these;
    // seq (insert order) must not.
    await prisma.appointmentStatusEvent.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        appointmentId: appt.id,
        status: 'IN_PROGRESS',
        statusSource: 'STAFF',
        createdAt: new Date('2026-09-01T05:00:10Z'),
      },
    })
    await prisma.appointmentStatusEvent.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        appointmentId: appt.id,
        status: 'COMPLETED',
        statusSource: 'STAFF',
        createdAt: new Date('2026-09-01T05:00:00Z'),
      },
    })
    const { events } = await (await req('GET', `/appointments/${appt.id}/status-history`)).json()
    expect(events.map((e: { status: string }) => e.status)).toEqual([
      'SCHEDULED',
      'IN_PROGRESS',
      'COMPLETED',
    ])
    expect(events[1].seq).toBeLessThan(events[2].seq)
  })

  it('404s for an unknown appointment', async () => {
    const res = await req(
      'GET',
      '/appointments/00000000-0000-0000-0000-000000000000/status-history',
    )
    expect(res.status).toBe(404)
  })

  it('links a rebook to the booking it replaced', async () => {
    const { appt: original, staff } = await createViaApi()
    await req('PUT', `/appointments/${original.id}`, {
      status: 'CANCELLED',
      status_reason: 'advance-cancel',
      acting_staff_id: staff.id,
    })

    const customer2 = await seedTestCustomer({ email: 'rebook@example.com' })
    const res = await req('POST', '/appointments', {
      customer_id: customer2.id,
      staff_id: staff.id,
      starts_at: '2026-09-02T03:00:00Z',
      ends_at: '2026-09-02T04:00:00Z',
      rebooked_from_appointment_id: original.id,
    })
    expect(res.status).toBe(201)
    const rebook = await res.json()
    expect(rebook.rebooked_from_appointment_id).toBe(original.id)

    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: rebook.id } })
    expect(row.rebookedFromId).toBe(original.id)
  })

  it('404s a rebook link to an appointment that is not in this business', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const res = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-09-01T03:00:00Z',
      ends_at: '2026-09-01T04:00:00Z',
      rebooked_from_appointment_id: '00000000-0000-0000-0000-0000000000aa',
    })
    expect(res.status).toBe(404)
  })

  it('the orphan sweep writes a CANCELLED event with the machine reason', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const appt = await prisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        customerId: customer.id,
        staffId: staff.id,
        startsAt: new Date('2026-09-01T03:00:00+09:00'),
        endsAt: new Date('2026-09-01T04:00:00+09:00'),
        source: 'QUICKRESERVE',
        status: 'SCHEDULED',
        statusSource: 'QR',
      },
    })
    const count = await markOrphanedCancelled(
      TEST_BUSINESS_ID,
      new Date('2026-09-01T00:00:00+09:00'),
      new Date('2026-09-02T00:00:00+09:00'),
      [],
    )
    expect(count).toBe(1)

    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(row.status).toBe('CANCELLED')
    expect(row.cancelledAt).not.toBeNull()

    const events = await prisma.appointmentStatusEvent.findMany({
      where: { appointmentId: appt.id },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      status: 'CANCELLED',
      statusSource: 'QR',
      reason: 'qr-orphan-sweep',
    })
  })

  it('the sweep skips seen ids — and writes no events for them', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const appt = await prisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        customerId: customer.id,
        staffId: staff.id,
        startsAt: new Date('2026-09-01T03:00:00+09:00'),
        endsAt: new Date('2026-09-01T04:00:00+09:00'),
        source: 'QUICKRESERVE',
        status: 'SCHEDULED',
        statusSource: 'QR',
      },
    })
    const count = await markOrphanedCancelled(
      TEST_BUSINESS_ID,
      new Date('2026-09-01T00:00:00+09:00'),
      new Date('2026-09-02T00:00:00+09:00'),
      [appt.id],
    )
    expect(count).toBe(0)
    const events = await prisma.appointmentStatusEvent.findMany({
      where: { appointmentId: appt.id },
    })
    expect(events).toHaveLength(0)
  })
})
