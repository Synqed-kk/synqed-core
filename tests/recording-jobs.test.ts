// Server-side pipeline job store: idempotent enqueue, atomic claim (incl.
// stale-claim reclaim), complete/fail lifecycle, FAILED re-arm, tenant status.
import { describe, it, expect, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import app from '../src/index.js'
import { testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

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

afterEach(async () => {
  await testPrisma.recordingJob.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
})

describe('recording jobs', () => {
  it('enqueue is idempotent by recording_session_id', async () => {
    const rsid = randomUUID()
    const a = await (await req('POST', '/recording-jobs', { recording_session_id: rsid, payload: { p: 1 } })).json()
    const b = await (await req('POST', '/recording-jobs', { recording_session_id: rsid, payload: { p: 2 } })).json()
    expect(b.id).toBe(a.id)
    expect(b.payload).toEqual({ p: 1 }) // original payload kept while live
  })

  it('claim → complete lifecycle; claim is api-key-only and empty queue = 204', async () => {
    const rsid = randomUUID()
    await req('POST', '/recording-jobs', { recording_session_id: rsid, payload: {} })
    const claimed = await (await req('POST', '/recording-jobs/claim')).json()
    expect(claimed.recording_session_id).toBe(rsid)
    expect(claimed.status).toBe('RUNNING')
    expect(claimed.attempts).toBe(1)

    const krid = randomUUID()
    const done = await (await req('POST', `/recording-jobs/${claimed.id}/complete`, { karute_record_id: krid })).json()
    expect(done.status).toBe('DONE')
    expect(done.karute_record_id).toBe(krid)

    const empty = await req('POST', '/recording-jobs/claim')
    expect(empty.status).toBe(204)

    // Tenant status poll sees the terminal state
    const polled = await (await req('GET', `/recording-jobs/by-recording/${rsid}`)).json()
    expect(polled.status).toBe('DONE')
  })

  it('fail requeues while attempts remain, FAILED when spent; enqueue re-arms FAILED', async () => {
    const rsid = randomUUID()
    const job = await (await req('POST', '/recording-jobs', { recording_session_id: rsid, payload: {} })).json()
    for (let i = 1; i <= 3; i++) {
      const claimed = await (await req('POST', '/recording-jobs/claim')).json()
      expect(claimed.id).toBe(job.id)
      const failed = await (await req('POST', `/recording-jobs/${job.id}/fail`, { error: `boom ${i}` })).json()
      expect(failed.status).toBe(i < 3 ? 'QUEUED' : 'FAILED')
    }
    // Retry in the UI = enqueue again → re-armed
    const rearmed = await (await req('POST', '/recording-jobs', { recording_session_id: rsid, payload: { retry: true } })).json()
    expect(rearmed.status).toBe('QUEUED')
    expect(rearmed.attempts).toBe(0)
    expect(rearmed.payload).toEqual({ retry: true })
  })

  it('a stale RUNNING claim is reclaimable (dead-worker recovery)', async () => {
    const rsid = randomUUID()
    await req('POST', '/recording-jobs', { recording_session_id: rsid, payload: {} })
    await (await req('POST', '/recording-jobs/claim')).json()
    // Age the claim past the threshold
    await testPrisma.recordingJob.updateMany({
      where: { recordingSessionId: rsid },
      data: { claimedAt: new Date(Date.now() - 11 * 60_000) },
    })
    const reclaimed = await (await req('POST', '/recording-jobs/claim')).json()
    expect(reclaimed.recording_session_id).toBe(rsid)
    expect(reclaimed.attempts).toBe(2)
  })
})
