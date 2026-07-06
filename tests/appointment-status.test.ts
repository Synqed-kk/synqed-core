import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { prisma } from '../src/db/client.js'
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

async function seedAppt(status?: 'SCHEDULED' | 'CANCELLED') {
  const customer = await seedTestCustomer()
  const staff = await seedTestStaff()
  const appt = await seedTestAppointment({
    customerId: customer.id,
    staffId: staff.id,
    startsAt: new Date('2026-08-01T03:00:00Z'),
    endsAt: new Date('2026-08-01T04:00:00Z'),
    status,
  })
  return { appt, staff }
}

describe('PUT /appointments/:id — staff-set status + audit', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('sets NO_SHOW with the full staff audit trail', async () => {
    const { appt, staff } = await seedAppt()
    const res = await req('PUT', `/appointments/${appt.id}`, {
      status: 'NO_SHOW',
      status_reason: 'no-show-no-contact',
      acting_staff_id: staff.id,
    })
    expect(res.status).toBe(200)

    // Audit trail must be exposed in the API response (Liam's UI reads it).
    const json = await res.json()
    expect(json.status).toBe('NO_SHOW')
    expect(json.status_source).toBe('STAFF')
    expect(json.status_set_by).toBe(staff.id)
    expect(json.status_reason).toBe('no-show-no-contact')
    expect(json.status_set_at).not.toBeNull()
    expect(json.cancelled_at).not.toBeNull()

    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(row.status).toBe('NO_SHOW')
    expect(row.statusSource).toBe('STAFF')
    expect(row.statusSetBy).toBe(staff.id)
    expect(row.statusReason).toBe('no-show-no-contact')
    expect(row.statusSetAt).not.toBeNull()
    expect(row.cancelledAt).not.toBeNull()
  })

  it('cancelling sets cancelledAt; returning to SCHEDULED clears it', async () => {
    const { appt, staff } = await seedAppt()
    await req('PUT', `/appointments/${appt.id}`, {
      status: 'CANCELLED',
      status_reason: 'advance-cancel',
      acting_staff_id: staff.id,
    })
    const cancelled = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(cancelled.cancelledAt).not.toBeNull()
    expect(cancelled.statusReason).toBe('advance-cancel')

    await req('PUT', `/appointments/${appt.id}`, {
      status: 'SCHEDULED',
      acting_staff_id: staff.id,
    })
    const restored = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(restored.status).toBe('SCHEDULED')
    expect(restored.cancelledAt).toBeNull()
  })

  it('non-status edits leave the audit trail untouched', async () => {
    const { appt, staff } = await seedAppt()
    // First, staff-set NO_SHOW with a reason.
    await req('PUT', `/appointments/${appt.id}`, {
      status: 'NO_SHOW',
      status_reason: 'no-show-no-contact',
      acting_staff_id: staff.id,
    })
    // A later edit that doesn't touch status must not stamp/clear the audit.
    await req('PUT', `/appointments/${appt.id}`, { title: 'カット' })
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(row.status).toBe('NO_SHOW')
    expect(row.statusSource).toBe('STAFF')
    expect(row.statusReason).toBe('no-show-no-contact')
    expect(row.title).toBe('カット')
  })

  it('404s for an unknown appointment', async () => {
    const { staff } = await seedAppt()
    const res = await req(
      'PUT',
      '/appointments/00000000-0000-0000-0000-000000000000',
      { status: 'CANCELLED', acting_staff_id: staff.id },
    )
    expect(res.status).toBe(404)
  })
})
