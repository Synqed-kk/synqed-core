import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/supabase-auth.service.js', () => ({
  verifySupabaseAccessToken: vi.fn(async (token: string) => token),
}))

import app from '../src/index.js'
import { SynqedClient } from '../packages/client/src/index.js'
import { testPrisma, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY

// Real SDK -> HTTP router -> authorization -> PostgreSQL. Only Supabase token
// verification and network transport are substituted. Storage and AI providers
// are outside this backend contract test; their outputs below are fixtures.
const businessId = randomUUID()
const userId = randomUUID()
const storeId = randomUUID()
let customerId: string
let staffCardId: string

function client(accessToken?: string) {
  return new SynqedClient({
    baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId, accessToken,
  })
}

beforeEach(async () => {
  vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) =>
    app.request(String(url), init),
  )
  const staff = await testPrisma.staff.create({
    data: { businessId, userId, name: 'Recording regression', role: 'STYLIST', isActive: true },
  })
  staffCardId = staff.id
  const customer = await testPrisma.customer.create({
    data: { businessId, name: 'Synthetic recording customer' },
  })
  customerId = customer.id
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await testPrisma.recordingJob.deleteMany({ where: { businessId } })
  await testPrisma.karuteEntry.deleteMany({ where: { karuteRecord: { businessId } } })
  await testPrisma.karuteRecord.deleteMany({ where: { businessId } })
  await testPrisma.recordingSession.deleteMany({ where: { businessId } })
  await testPrisma.staff.deleteMany({ where: { businessId } })
  await testPrisma.customer.deleteMany({ where: { businessId } })
})

describe('ordinary staff recording -> saved Karute backend contract', () => {
  it.each(['auth user', 'staff card'] as const)('finalizes a %s-stamped take and reads the saved record', async (identityShape) => {
    const staff = client(userId)
    const worker = client()
    expect(userId).not.toBe(staffCardId)
    // Karute session-mint.ts uses the auth ID. Historical/Core callers can
    // use the card ID. Testing only the latter missed the September 4 outage.
    const recording = await staff.recordings.create({
      customer_id: customerId, store_id: storeId,
      staff_id: identityShape === 'auth user' ? userId : staffCardId,
      status: 'RECORDING',
    })
    const audioPath = `app_${businessId}_regression.webm`
    await staff.recordings.update(recording.id, { audio_storage_path: audioPath })
    await staff.recordings.update(recording.id, { status: 'UPLOADING', duration_seconds: 60 })
    const finalized = await staff.recordings.get(recording.id)
    expect(finalized).toMatchObject({ status: 'UPLOADING', duration_seconds: 60, audio_storage_path: audioPath })

    const job = await staff.recordingJobs.enqueue({
      recording_session_id: recording.id,
      payload: { customer_id: customerId, staff_id: recording.staff_id, store_id: storeId, audio_path: audioPath },
    })
    // The claim verb is deliberately cross-tenant. This suite must run in an
    // isolated test database with no other worker, as CI does.
    const claimed = await worker.recordingJobs.claim()
    expect(claimed?.id).toBe(job.id)

    const save = {
      customer_id: customerId, staff_id: recording.staff_id, store_id: storeId,
      recording_session_id: recording.id,
      transcript: 'Synthetic transcript', ai_summary: 'Synthetic summary',
      entries: [{ category: 'OTHER' as const, content: 'Synthetic entry' }],
    }
    const record = await worker.karuteRecords.create(save)
    // A lost response/retry converges on one persisted record.
    expect((await worker.karuteRecords.create(save)).id).toBe(record.id)
    await worker.recordingJobs.complete(job.id, record.id)
    expect(await staff.recordingJobs.getByRecordingSession(recording.id)).toMatchObject({
      status: 'DONE', karute_record_id: record.id,
    })
    expect(await staff.karuteRecords.get(record.id)).toMatchObject({
      id: record.id, transcript: save.transcript, customer_id: customerId,
    })
    const list = await staff.karuteRecords.list({ store_id: storeId, customer_id: customerId })
    expect(list.total).toBe(1)
    expect(list.karute_records.map(row => row.id)).toEqual([record.id])
  })
})
