import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  seedTestAppointment,
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

// The update path had no overlap check at all — createAppointment refused a
// taken slot, but a PUT (customer reschedule via SYNQED Reserve, calendar
// drag, staff reassignment) moved a booking anywhere without looking.
describe('Appointments — reschedule/reassign overlap guard', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('409 when rescheduling onto an occupied staff slot', async () => {
    const c1 = await seedTestCustomer({ email: 'guard-1a@example.com' })
    const c2 = await seedTestCustomer({ email: 'guard-1b@example.com' })
    const staff = await seedTestStaff()
    await seedTestAppointment({
      customerId: c1.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })
    const movable = await seedTestAppointment({
      customerId: c2.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T12:00:00Z'),
      endsAt: new Date('2026-05-10T13:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${movable.id}`, {
      starts_at: '2026-05-10T10:30:00Z',
      ends_at: '2026-05-10T11:30:00Z',
    })
    expect(res.status).toBe(409)
  })

  it('200 when rescheduling to a free slot', async () => {
    const customer = await seedTestCustomer({ email: 'guard-2@example.com' })
    const staff = await seedTestStaff()
    const movable = await seedTestAppointment({
      customerId: customer.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${movable.id}`, {
      starts_at: '2026-05-10T14:00:00Z',
      ends_at: '2026-05-10T15:00:00Z',
    })
    expect(res.status).toBe(200)
  })

  it('200 when extending a booking over only itself (self-overlap excluded)', async () => {
    const customer = await seedTestCustomer({ email: 'guard-3@example.com' })
    const staff = await seedTestStaff()
    const own = await seedTestAppointment({
      customerId: customer.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${own.id}`, {
      ends_at: '2026-05-10T11:30:00Z',
    })
    expect(res.status).toBe(200)
  })

  it('200 when the occupying booking is CANCELLED (terminal frees the slot)', async () => {
    const c1 = await seedTestCustomer({ email: 'guard-4a@example.com' })
    const c2 = await seedTestCustomer({ email: 'guard-4b@example.com' })
    const staff = await seedTestStaff()
    await seedTestAppointment({
      customerId: c1.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
      status: 'CANCELLED',
    })
    const movable = await seedTestAppointment({
      customerId: c2.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T12:00:00Z'),
      endsAt: new Date('2026-05-10T13:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${movable.id}`, {
      starts_at: '2026-05-10T10:00:00Z',
      ends_at: '2026-05-10T11:00:00Z',
    })
    expect(res.status).toBe(200)
  })

  it('409 when reassigning to a staff member who is busy at that time', async () => {
    const c1 = await seedTestCustomer({ email: 'guard-5a@example.com' })
    const c2 = await seedTestCustomer({ email: 'guard-5b@example.com' })
    const staffA = await seedTestStaff()
    const staffB = await seedTestStaff({ name: 'テストスタッフB' })
    await seedTestAppointment({
      customerId: c1.id,
      staffId: staffB.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })
    const movable = await seedTestAppointment({
      customerId: c2.id,
      staffId: staffA.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${movable.id}`, {
      staff_id: staffB.id,
    })
    expect(res.status).toBe(409)
  })

  it('409 when reviving a CANCELLED booking into a now-occupied slot', async () => {
    const c1 = await seedTestCustomer({ email: 'guard-6a@example.com' })
    const c2 = await seedTestCustomer({ email: 'guard-6b@example.com' })
    const staff = await seedTestStaff()
    const revived = await seedTestAppointment({
      customerId: c1.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
      status: 'CANCELLED',
    })
    await seedTestAppointment({
      customerId: c2.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${revived.id}`, {
      status: 'SCHEDULED',
    })
    expect(res.status).toBe(409)
  })

  it('200 for a metadata-only update while another booking overlaps elsewhere', async () => {
    const c1 = await seedTestCustomer({ email: 'guard-7@example.com' })
    const staff = await seedTestStaff()
    const appt = await seedTestAppointment({
      customerId: c1.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${appt.id}`, {
      notes: 'メモだけの更新',
    })
    expect(res.status).toBe(200)
  })

  it('exactly one winner when two requests race for the same free slot', async () => {
    // The advisory-lock serialization: both requests used to pass the
    // check-then-write gap and both commit. 5 rounds — every round must
    // produce exactly one 201 and one 409.
    const staff = await seedTestStaff()
    for (let round = 0; round < 5; round++) {
      const cA = await seedTestCustomer({ email: `guard-race-${round}a@example.com` })
      const cB = await seedTestCustomer({ email: `guard-race-${round}b@example.com` })
      const slot = {
        starts_at: `2026-06-0${round + 1}T10:00:00Z`,
        ends_at: `2026-06-0${round + 1}T11:00:00Z`,
      }
      const [r1, r2] = await Promise.all([
        req('POST', '/appointments', { customer_id: cA.id, staff_id: staff.id, ...slot }),
        req('POST', '/appointments', { customer_id: cB.id, staff_id: staff.id, ...slot }),
      ])
      const statuses = [r1.status, r2.status].sort()
      expect(statuses).toEqual([201, 409])
    }
  })

  it('exactly one winner when a create and a reschedule race for the same free slot', async () => {
    const staff = await seedTestStaff()
    for (let round = 0; round < 5; round++) {
      const cA = await seedTestCustomer({ email: `guard-race2-${round}a@example.com` })
      const cB = await seedTestCustomer({ email: `guard-race2-${round}b@example.com` })
      const target = {
        starts_at: `2026-06-1${round}T10:00:00Z`,
        ends_at: `2026-06-1${round}T11:00:00Z`,
      }
      const movable = await seedTestAppointment({
        customerId: cB.id,
        staffId: staff.id,
        startsAt: new Date(`2026-06-1${round}T14:00:00Z`),
        endsAt: new Date(`2026-06-1${round}T15:00:00Z`),
      })
      const [r1, r2] = await Promise.all([
        req('POST', '/appointments', { customer_id: cA.id, staff_id: staff.id, ...target }),
        req('PUT', `/appointments/${movable.id}`, target),
      ])
      // One of the two must win, the other must 409 — create wins → PUT 409,
      // or PUT wins (200) → create 409. Both-succeed is the raced double-book.
      const okCount = [r1.status, r2.status].filter((s) => s === 200 || s === 201).length
      const conflictCount = [r1.status, r2.status].filter((s) => s === 409).length
      expect(okCount).toBe(1)
      expect(conflictCount).toBe(1)
    }
  })

  it('400 when a single-field time update inverts the window', async () => {
    // starts_at moved past the existing ends_at: an inverted range satisfies
    // no overlap predicate, so without the explicit check it persisted garbage
    // that every future conflict query was blind to (verifier finding).
    const customer = await seedTestCustomer({ email: 'guard-9@example.com' })
    const staff = await seedTestStaff()
    const appt = await seedTestAppointment({
      customerId: customer.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${appt.id}`, {
      starts_at: '2026-05-10T12:00:00Z',
    })
    expect(res.status).toBe(400)
  })

  it('400 when create is given an inverted window', async () => {
    const customer = await seedTestCustomer({ email: 'guard-10@example.com' })
    const staff = await seedTestStaff()

    const res = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-05-10T11:00:00Z',
      ends_at: '2026-05-10T10:00:00Z',
    })
    expect(res.status).toBe(400)
  })

  it('200 when cancelling with a time change onto an occupied slot (terminal never occupies)', async () => {
    const c1 = await seedTestCustomer({ email: 'guard-11a@example.com' })
    const c2 = await seedTestCustomer({ email: 'guard-11b@example.com' })
    const staff = await seedTestStaff()
    await seedTestAppointment({
      customerId: c1.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })
    const cancelled = await seedTestAppointment({
      customerId: c2.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T12:00:00Z'),
      endsAt: new Date('2026-05-10T13:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${cancelled.id}`, {
      status: 'CANCELLED',
      starts_at: '2026-05-10T10:00:00Z',
      ends_at: '2026-05-10T11:00:00Z',
    })
    expect(res.status).toBe(200)
  })

  it('409 (not 500) when a reschedule collides with the same customer\'s other booking', async () => {
    // The partial unique index (business, customer, starts_at) also fires on
    // UPDATE; without the catch this surfaced as a raw P2002 → 500.
    const customer = await seedTestCustomer({ email: 'guard-8@example.com' })
    const staffA = await seedTestStaff()
    const staffB = await seedTestStaff({ name: 'テストスタッフB' })
    await seedTestAppointment({
      customerId: customer.id,
      staffId: staffA.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
    })
    const movable = await seedTestAppointment({
      customerId: customer.id,
      staffId: staffB.id,
      startsAt: new Date('2026-05-10T12:00:00Z'),
      endsAt: new Date('2026-05-10T13:00:00Z'),
    })

    const res = await req('PUT', `/appointments/${movable.id}`, {
      starts_at: '2026-05-10T10:00:00Z',
      ends_at: '2026-05-10T11:00:00Z',
    })
    expect(res.status).toBe(409)
  })
})
