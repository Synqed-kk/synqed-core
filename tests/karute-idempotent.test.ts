import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { prisma } from '../src/db/client.js'
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

describe('Karute Records — idempotent create by recording_session_id', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('a retried save with the same recording_session_id returns the existing record, not a duplicate', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    // recording_session_id is a FK to recording_sessions — seed one.
    const session = await prisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id },
    })
    const recordingSessionId = session.id
    const body = {
      customer_id: customer.id,
      staff_id: staff.id,
      recording_session_id: recordingSessionId,
      transcript: 'first save',
    }

    const first = await req('POST', '/karute-records', body)
    expect(first.status).toBeLessThan(300)
    const firstJson = await first.json()

    // Retry (e.g. flaky wifi): same idempotency id, would have double-inserted.
    const second = await req('POST', '/karute-records', {
      ...body,
      transcript: 'retry',
    })
    expect(second.status).toBeLessThan(300)
    const secondJson = await second.json()

    // Same row returned — no duplicate.
    expect(secondJson.id).toBe(firstJson.id)

    // And exactly one row exists for this recording session.
    const count = await prisma.karuteRecord.count({
      where: { recordingSessionId, businessId: TEST_BUSINESS_ID },
    })
    expect(count).toBe(1)
  })
})
