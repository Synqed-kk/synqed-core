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
