import { prisma } from '../db/client.js'
import type { RecordingJobStatus, Prisma } from '@prisma/client'

// Server-side recording→karute pipeline state. Enqueue is idempotent by
// recording_session_id; claim is atomic (SKIP LOCKED) and cross-tenant — the
// karute worker sweeps every business with one trusted key. A RUNNING job whose
// claim is older than STALE_CLAIM_MINUTES is reclaimable: the worker died
// mid-run (serverless timeout, deploy) and at-least-once semantics are safe
// because the terminal save is idempotent (recording_session_id unique on
// karute_records + the upsert-by-recording save path).

const STALE_CLAIM_MINUTES = 10

export interface RecordingJobPublic {
  id: string
  business_id: string
  recording_session_id: string
  status: RecordingJobStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  payload: unknown
  karute_record_id: string | null
  claimed_at: string | null
  created_at: string
  updated_at: string
}

function toPublic(r: {
  id: string
  businessId: string
  recordingSessionId: string
  status: RecordingJobStatus
  attempts: number
  maxAttempts: number
  lastError: string | null
  payload: Prisma.JsonValue
  karuteRecordId: string | null
  claimedAt: Date | null
  createdAt: Date
  updatedAt: Date
}): RecordingJobPublic {
  return {
    id: r.id,
    business_id: r.businessId,
    recording_session_id: r.recordingSessionId,
    status: r.status,
    attempts: r.attempts,
    max_attempts: r.maxAttempts,
    last_error: r.lastError,
    payload: r.payload,
    karute_record_id: r.karuteRecordId,
    claimed_at: r.claimedAt ? r.claimedAt.toISOString() : null,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }
}

/** Idempotent enqueue: one job per recording session, ever. Re-enqueueing an
 *  existing job returns it unchanged — EXCEPT a FAILED job out of attempts,
 *  which is re-armed (fresh attempts) so "retry" in the UI is just enqueue. */
export async function enqueue(
  businessId: string,
  recordingSessionId: string,
  payload: unknown,
): Promise<RecordingJobPublic> {
  const existing = await prisma.recordingJob.findUnique({
    where: { recordingSessionId },
  })
  if (existing) {
    if (existing.businessId !== businessId) throw new Error('Job not found')
    if (existing.status === 'FAILED') {
      const rearmed = await prisma.recordingJob.update({
        where: { id: existing.id },
        data: {
          status: 'QUEUED',
          attempts: 0,
          lastError: null,
          claimedAt: null,
          payload: payload as Prisma.InputJsonValue,
        },
      })
      return toPublic(rearmed)
    }
    return toPublic(existing)
  }
  const row = await prisma.recordingJob.create({
    data: {
      businessId,
      recordingSessionId,
      payload: payload as Prisma.InputJsonValue,
    },
  })
  return toPublic(row)
}

/** Atomically claim the next runnable job (QUEUED, or RUNNING with a stale
 *  claim). SKIP LOCKED so concurrent workers can't double-claim. Cross-tenant. */
export async function claimNext(): Promise<RecordingJobPublic | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE recording_jobs
       SET status = 'RUNNING', claimed_at = now(), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM recording_jobs
        WHERE status = 'QUEUED'
           OR (status = 'RUNNING' AND claimed_at < now() - (${STALE_CLAIM_MINUTES} || ' minutes')::interval)
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id`
  if (rows.length === 0) return null
  const row = await prisma.recordingJob.findUniqueOrThrow({ where: { id: rows[0].id } })
  return toPublic(row)
}

export async function complete(
  id: string,
  karuteRecordId: string,
): Promise<RecordingJobPublic> {
  const row = await prisma.recordingJob.update({
    where: { id },
    data: { status: 'DONE', karuteRecordId, lastError: null },
  })
  return toPublic(row)
}

/** Mark a run failed: back to QUEUED while attempts remain (the claimed
 *  attempt already counted), FAILED when they're spent. */
export async function fail(id: string, error: string): Promise<RecordingJobPublic> {
  const job = await prisma.recordingJob.findUniqueOrThrow({ where: { id } })
  const spent = job.attempts >= job.maxAttempts
  const row = await prisma.recordingJob.update({
    where: { id },
    data: {
      status: spent ? 'FAILED' : 'QUEUED',
      lastError: error.slice(0, 2000),
      claimedAt: null,
    },
  })
  return toPublic(row)
}

/** Tenant-scoped status poll. */
export async function getByRecordingSession(
  businessId: string,
  recordingSessionId: string,
): Promise<RecordingJobPublic | null> {
  const row = await prisma.recordingJob.findFirst({
    where: { businessId, recordingSessionId },
  })
  return row ? toPublic(row) : null
}
