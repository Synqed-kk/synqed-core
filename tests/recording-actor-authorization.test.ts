import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/supabase-auth.service.js', () => ({
  verifySupabaseAccessToken: vi.fn(async (token: string) =>
    token === 'invalid-token' ? null : token,
  ),
}))

import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestStaff,
  testPrisma,
  TEST_API_KEY,
  TEST_BUSINESS_ID,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const stylistUserId = '90000000-0000-0000-0000-000000000091'
const ownerUserId = '90000000-0000-0000-0000-000000000092'
const managerUserId = '90000000-0000-0000-0000-000000000093'

function req(method: string, path: string, userId?: string, body?: unknown) {
  const headers: Record<string, string> = {
    'x-api-key': TEST_API_KEY,
    'x-business-id': TEST_BUSINESS_ID,
    'Content-Type': 'application/json',
  }
  if (userId) headers.Authorization = `Bearer ${userId}`
  return app.request(`/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function clean() {
  await testPrisma.recordingDiscardEvent.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.transcriptionSegment.deleteMany({
    where: { recordingSession: { businessId: TEST_BUSINESS_ID } },
  })
  await testPrisma.recordingSession.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
}

beforeEach(clean)
afterEach(clean)

describe('actor-authenticated recording writes', () => {
  it('requires a verified active member, fences ordinary staff to owned sessions, and permits recordings.viewAll', async () => {
    const stylist = await seedTestStaff({ userId: stylistUserId, role: 'STYLIST' })
    const owner = await seedTestStaff({ userId: ownerUserId, role: 'OWNER' })
    const other = await seedTestStaff({ name: '別スタッフ' })
    const ownRecording = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: stylist.id, durationSeconds: 10 },
    })
    const otherRecording = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: other.id, durationSeconds: 20 },
    })

    expect((await req('PUT', `/recordings/${ownRecording.id}`, undefined, {
      duration_seconds: 30,
    })).status).toBe(401)
    expect((await req('PUT', `/recordings/${ownRecording.id}`, 'invalid-token', {
      duration_seconds: 30,
    })).status).toBe(401)

    const own = await req('PUT', `/recordings/${ownRecording.id}`, stylistUserId, {
      duration_seconds: 30,
    })
    expect(own.status).toBe(200)
    expect((await own.json()).duration_seconds).toBe(30)

    const denied = await req('PUT', `/recordings/${otherRecording.id}`, stylistUserId, {
      duration_seconds: 99,
      status: 'COMPLETED',
    })
    expect(denied.status).toBe(403)
    expect(await testPrisma.recordingSession.findUnique({ where: { id: otherRecording.id } })).toMatchObject({
      durationSeconds: 20,
      status: 'RECORDING',
    })

    const elevated = await req('PUT', `/recordings/${otherRecording.id}`, ownerUserId, {
      duration_seconds: 40,
    })
    expect(elevated.status).toBe(200)
    expect((await elevated.json()).duration_seconds).toBe(40)
    expect(owner.id).not.toBe(stylist.id)
  })
})

describe('manager confirmation of recording discards', () => {
  it('derives the confirmer, requires manager capabilities, and is immutable and idempotent', async () => {
    const stylist = await seedTestStaff({ userId: stylistUserId, role: 'STYLIST' })
    const manager = await seedTestStaff({ userId: managerUserId, role: 'ADMIN' })
    await seedTestStaff({ userId: ownerUserId, role: 'OWNER' })
    const recording = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: stylist.id },
    })
    const discard = await testPrisma.recordingDiscardEvent.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        recordingSessionId: recording.id,
        source: 'STAFF',
        discardedBy: stylist.id,
        reason: 'written reason',
      },
    })

    expect((await req('PUT', `/recording-discards/${discard.id}/confirmation`, stylistUserId, {})).status).toBe(403)
    expect((await req('PUT', `/recording-discards/${discard.id}/confirmation`, managerUserId, {
      reason: 'attempted rewrite',
    })).status).toBe(400)

    const confirmed = await req(
      'PUT',
      `/recording-discards/${discard.id}/confirmation`,
      managerUserId,
      {},
    )
    expect(confirmed.status).toBe(200)
    const first = await confirmed.json()
    expect(first.confirmed_by).toBe(manager.id)
    expect(first.confirmed_at).toBeTruthy()
    expect(first.reason).toBe('written reason')
    expect(first.discarded_by).toBe(stylist.id)

    const retried = await req(
      'PUT',
      `/recording-discards/${discard.id}/confirmation`,
      ownerUserId,
      {},
    )
    expect(retried.status).toBe(200)
    expect(await retried.json()).toMatchObject({
      confirmed_by: manager.id,
      confirmed_at: first.confirmed_at,
      reason: 'written reason',
      discarded_by: stylist.id,
      source: 'STAFF',
    })
  })
})
