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

describe('PATCH /appointments/:id/status — staff-set status + audit', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('sets NO_SHOW with the full staff audit trail', async () => {
    const { appt, staff } = await seedAppt()
    const res = await req('PATCH', `/appointments/${appt.id}/status`, {
      status: 'NO_SHOW',
      reason: '無断キャンセル',
      acting_staff_id: staff.id,
    })
    expect(res.status).toBe(200)

    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(row.status).toBe('NO_SHOW')
    expect(row.statusSource).toBe('STAFF')
    expect(row.statusSetBy).toBe(staff.id)
    expect(row.statusReason).toBe('無断キャンセル')
    expect(row.statusSetAt).not.toBeNull()
    expect(row.cancelledAt).not.toBeNull()
  })

  it('cancelling sets cancelledAt; returning to SCHEDULED clears it', async () => {
    const { appt, staff } = await seedAppt('CANCELLED')
    await req('PATCH', `/appointments/${appt.id}/status`, {
      status: 'CANCELLED',
      acting_staff_id: staff.id,
    })
    const cancelled = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(cancelled.cancelledAt).not.toBeNull()

    await req('PATCH', `/appointments/${appt.id}/status`, {
      status: 'SCHEDULED',
      acting_staff_id: staff.id,
    })
    const restored = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(restored.status).toBe('SCHEDULED')
    expect(restored.cancelledAt).toBeNull()
  })

  it('404s for an unknown appointment', async () => {
    const { staff } = await seedAppt()
    const res = await req(
      'PATCH',
      '/appointments/00000000-0000-0000-0000-000000000000/status',
      { status: 'CANCELLED', acting_staff_id: staff.id },
    )
    expect(res.status).toBe(404)
  })
})
