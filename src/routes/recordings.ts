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
  const businessId = c.get('businessId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listRecordingsSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await recordingService.listRecordings(businessId, parsed.data)
  return c.json(result)
})

recordingRoutes.get('/:id', async (c) => {
  const businessId = c.get('businessId')
  const rec = await recordingService.getRecording(businessId, c.req.param('id'))
  if (!rec) return c.json({ error: 'Recording not found' }, 404)
  return c.json(rec)
})

recordingRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createRecordingSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const rec = await recordingService.createRecording(businessId, parsed.data)
  return c.json(rec, 201)
})

recordingRoutes.put('/:id', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateRecordingSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const rec = await recordingService.updateRecording(businessId, c.req.param('id'), parsed.data)
    return c.json(rec)
  } catch (err) {
    if (err instanceof Error && err.message === 'Recording not found') {
      return c.json({ error: 'Recording not found' }, 404)
    }
    throw err
  }
})

recordingRoutes.delete('/:id', async (c) => {
  const businessId = c.get('businessId')
  try {
    await recordingService.deleteRecording(businessId, c.req.param('id'))
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
  const businessId = c.get('businessId')
  try {
    const segments = await recordingService.listSegments(businessId, c.req.param('id'))
    return c.json({ segments })
  } catch (err) {
    if (err instanceof Error && err.message === 'Recording not found') {
      return c.json({ error: 'Recording not found' }, 404)
    }
    throw err
  }
})

recordingRoutes.post('/:id/segments', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = bulkSegmentsSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const segments = await recordingService.upsertSegments(
      businessId,
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
