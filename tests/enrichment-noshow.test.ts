import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../src/db/client.js'
import { customerEnrichment } from '../src/services/customer-enrichment.service.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  TEST_BUSINESS_ID,
} from './setup.js'

describe('customerEnrichment — NO_SHOW is not a visit', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('excludes a NO_SHOW appointment from the visit counts', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const past = (h: number) => ({
      startsAt: new Date(`2026-06-0${h}T03:00:00Z`),
      endsAt: new Date(`2026-06-0${h}T04:00:00Z`),
    })
    // One real past visit (COMPLETED) + one NO_SHOW that must not count.
    await prisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID, customerId: customer.id, staffId: staff.id,
        status: 'COMPLETED', ...past(1),
      },
    })
    await prisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID, customerId: customer.id, staffId: staff.id,
        status: 'NO_SHOW', statusSource: 'STAFF', ...past(2),
      },
    })

    const rows = await customerEnrichment(TEST_BUSINESS_ID)
    const row = rows.find((r) => r.customer_id === customer.id)
    expect(row).toBeDefined()
    expect(row!.past_appointment_count).toBe(1)
    expect(row!.dated_visit_count).toBe(1)
  })
})
