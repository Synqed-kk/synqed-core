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

describe('Appointments — overlap check', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('creates an appointment when no overlap', async () => {
    const customer = await seedTestCustomer({ email: 'appt-test-1@example.com' })
    const staff = await seedTestStaff()

    const res = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-05-10T10:00:00Z',
      ends_at: '2026-05-10T11:00:00Z',
    })

    expect(res.status).toBe(201)
  })

  it('returns 409 when a SCHEDULED appointment overlaps (mid-overlap)', async () => {
    const customer = await seedTestCustomer({ email: 'appt-test-2@example.com' })
    const staff = await seedTestStaff()

    // Seed an existing SCHEDULED appointment 10:00–11:00
    await seedTestAppointment({
      customerId: customer.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
      status: 'SCHEDULED',
    })

    // Attempt to book 10:30–11:30 (overlaps existing)
    const res = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-05-10T10:30:00Z',
      ends_at: '2026-05-10T11:30:00Z',
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/overlap/i)
  })

  it('does NOT return 409 for a CANCELLED appointment (cancelled slots are free)', async () => {
    const customer = await seedTestCustomer({ email: 'appt-test-3@example.com' })
    const staff = await seedTestStaff()

    // Seed a CANCELLED appointment in the same slot
    await seedTestAppointment({
      customerId: customer.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
      status: 'CANCELLED',
    })

    // Attempt to book the same slot — should succeed
    const res = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-05-10T10:00:00Z',
      ends_at: '2026-05-10T11:00:00Z',
    })

    expect(res.status).toBe(201)
  })

  it('does NOT return 409 for same staff but non-overlapping time (back-to-back)', async () => {
    const customer = await seedTestCustomer({ email: 'appt-test-4@example.com' })
    const staff = await seedTestStaff()

    // Existing appointment 10:00–11:00
    await seedTestAppointment({
      customerId: customer.id,
      staffId: staff.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
      status: 'SCHEDULED',
    })

    // Book immediately after (11:00–12:00), which is adjacent but not overlapping
    const res = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-05-10T11:00:00Z',
      ends_at: '2026-05-10T12:00:00Z',
    })

    expect(res.status).toBe(201)
  })

  it('does NOT return 409 for overlapping time but different staff', async () => {
    const customer = await seedTestCustomer({ email: 'appt-test-5@example.com' })
    const staff1 = await seedTestStaff()
    const staff2 = await seedTestStaff({ name: '別スタッフ', role: 'STYLIST' })

    // Existing appointment for staff1 10:00–11:00
    await seedTestAppointment({
      customerId: customer.id,
      staffId: staff1.id,
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T11:00:00Z'),
      status: 'SCHEDULED',
    })

    // Book staff2 in the same time window — should succeed (different staff)
    const res = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff2.id,
      starts_at: '2026-05-10T10:00:00Z',
      ends_at: '2026-05-10T11:00:00Z',
    })

    expect(res.status).toBe(201)
  })
})
