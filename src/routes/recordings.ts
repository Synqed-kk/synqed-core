import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import {
  createRecordingSchema,
  updateRecordingSchema,
  listRecordingsSchema,
  bulkSegmentsSchema,
} from '../validations/recording.js'
import * as recordingService from '../services/recording.service.js'

export const recordingRoutes = new Hono<AppEnv>()

recordingRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listRecordingsSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await recordingService.listRecordings(tenantId, parsed.data)
  return c.json(result)
})

recordingRoutes.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const rec = await recordingService.getRecording(tenantId, c.req.param('id'))
  if (!rec) return c.json({ error: 'Recording not found' }, 404)
  return c.json(rec)
})

recordingRoutes.post('/', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createRecordingSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const rec = await recordingService.createRecording(tenantId, parsed.data)
  return c.json(rec, 201)
})

recordingRoutes.put('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateRecordingSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const rec = await recordingService.updateRecording(tenantId, c.req.param('id'), parsed.data)
    return c.json(rec)
  } catch (err) {
    if (err instanceof Error && err.message === 'Recording not found') {
      return c.json({ error: 'Recording not found' }, 404)
    }
    throw err
  }
})

recordingRoutes.delete('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  try {
    await recordingService.deleteRecording(tenantId, c.req.param('id'))
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Recording not found') {
      return c.json({ error: 'Recording not found' }, 404)
    }
    throw err
  }
})

// Transcription segments — nested under a recording
recordingRoutes.get('/:id/segments', async (c) => {
  const tenantId = c.get('tenantId')
  try {
    const segments = await recordingService.listSegments(tenantId, c.req.param('id'))
    return c.json({ segments })
  } catch (err) {
    if (err instanceof Error && err.message === 'Recording not found') {
      return c.json({ error: 'Recording not found' }, 404)
    }
    throw err
  }
})

recordingRoutes.post('/:id/segments', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = bulkSegmentsSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const segments = await recordingService.upsertSegments(
      tenantId,
      c.req.param('id'),
      parsed.data.segments,
      parsed.data.replace ?? false,
    )
    return c.json({ segments })
  } catch (err) {
    if (err instanceof Error && err.message === 'Recording not found') {
      return c.json({ error: 'Recording not found' }, 404)
    }
    throw err
  }
})
