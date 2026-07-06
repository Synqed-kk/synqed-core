import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../src/db/client.js'
import {
  stripStaffLockedStatus,
  markOrphanedCancelled,
} from '../src/services/sync.service.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  TEST_BUSINESS_ID,
} from './setup.js'

describe('stripStaffLockedStatus — crawl never overwrites a staff decision', () => {
  const qrUpdate = { status: 'SCHEDULED', cancelledAt: null, title: 'refresh' }

  it('strips status + cancelledAt when the row is staff-CANCELLED', () => {
    const out = stripStaffLockedStatus({ ...qrUpdate }, {
      status: 'CANCELLED',
      statusSource: 'STAFF',
    })
    expect(out).not.toHaveProperty('status')
    expect(out).not.toHaveProperty('cancelledAt')
    expect(out.title).toBe('refresh')
  })

  it('strips for staff-NO_SHOW too', () => {
    const out = stripStaffLockedStatus({ ...qrUpdate }, {
      status: 'NO_SHOW',
      statusSource: 'STAFF',
    })
    expect(out).not.toHaveProperty('status')
  })

  it('keeps status when the row is not staff-set', () => {
    const out = stripStaffLockedStatus({ ...qrUpdate }, {
      status: 'CANCELLED',
      statusSource: 'QR',
    })
    expect(out).toHaveProperty('status', 'SCHEDULED')
  })

  it('keeps status for a non-terminal staff status', () => {
    const out = stripStaffLockedStatus({ ...qrUpdate }, {
      status: 'SCHEDULED',
      statusSource: 'STAFF',
    })
    expect(out).toHaveProperty('status', 'SCHEDULED')
  })
})

describe('markOrphanedCancelled — leaves staff-set rows alone', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  const start = new Date('2026-09-01T00:00:00+09:00')
  const end = new Date('2026-09-02T00:00:00+09:00')

  async function seedQrAppt(overrides: Record<string, unknown>) {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    return prisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        customerId: customer.id,
        staffId: staff.id,
        startsAt: new Date('2026-09-01T03:00:00+09:00'),
        endsAt: new Date('2026-09-01T04:00:00+09:00'),
        source: 'QUICKRESERVE',
        ...overrides,
      },
    })
  }

  it('does NOT flip a staff-set NO_SHOW that fell out of the feed', async () => {
    const appt = await seedQrAppt({ status: 'NO_SHOW', statusSource: 'STAFF' })
    // Not in seenIds → the orphan sweep would normally cancel it.
    await markOrphanedCancelled(TEST_BUSINESS_ID, start, end, [])
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(row.status).toBe('NO_SHOW')
  })

  it('still cancels a normal orphaned SCHEDULED QR booking', async () => {
    const appt = await seedQrAppt({ status: 'SCHEDULED', statusSource: 'QR' })
    await markOrphanedCancelled(TEST_BUSINESS_ID, start, end, [])
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })
    expect(row.status).toBe('CANCELLED')
  })
})
