import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as jobs from '../services/recording-job.service.js'

export const recordingJobRoutes = new Hono<AppEnv>()

const enqueueSchema = z.object({
  recording_session_id: z.string().uuid(),
  // Opaque to core — the karute worker owns the shape (audio path, save
  // inputs, acting staff). Capped so a runaway client can't bloat rows.
  payload: z.record(z.string(), z.unknown()),
})

// POST /v1/recording-jobs — tenant-scoped idempotent enqueue.
recordingJobRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = enqueueSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  if (JSON.stringify(parsed.data.payload).length > 16_384) {
    return c.json({ error: 'payload too large' }, 400)
  }
  const job = await jobs.enqueue(businessId, parsed.data.recording_session_id, parsed.data.payload)
  return c.json(job, 201)
})

// GET /v1/recording-jobs/by-recording/:recordingSessionId — tenant status poll.
recordingJobRoutes.get('/by-recording/:recordingSessionId', async (c) => {
  const businessId = c.get('businessId')
  const job = await jobs.getByRecordingSession(businessId, c.req.param('recordingSessionId'))
  if (!job) return c.json({ error: 'Job not found' }, 404)
  return c.json(job)
})

// POST /v1/recording-jobs/claim — WORKER verb (api-key only, cross-tenant):
// atomically claim the next runnable job. 204 when the queue is dry.
recordingJobRoutes.post('/claim', async (c) => {
  const job = await jobs.claimNext()
  if (!job) return c.body(null, 204)
  return c.json(job)
})

// POST /v1/recording-jobs/:id/complete — WORKER verb.
recordingJobRoutes.post('/:id/complete', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = z.object({ karute_record_id: z.string().uuid() }).safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const job = await jobs.complete(c.req.param('id'), parsed.data.karute_record_id)
  return c.json(job)
})

// POST /v1/recording-jobs/:id/fail — WORKER verb. Requeues while attempts
// remain; FAILED when spent.
recordingJobRoutes.post('/:id/fail', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = z.object({ error: z.string().min(1) }).safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const job = await jobs.fail(c.req.param('id'), parsed.data.error)
  return c.json(job)
})
