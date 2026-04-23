import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import {
  createKaruteRecordSchema,
  updateKaruteRecordSchema,
  listKaruteRecordsSchema,
} from '../validations/karute.js'
import * as karuteService from '../services/karute.service.js'

export const karuteRoutes = new Hono<AppEnv>()

karuteRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listKaruteRecordsSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await karuteService.listKaruteRecords(tenantId, parsed.data)
  return c.json(result)
})

// Lookup by recording_session_id — comes BEFORE /:id so the path segment
// doesn't eat "by-recording".
karuteRoutes.get('/by-recording/:recordingSessionId', async (c) => {
  const tenantId = c.get('tenantId')
  const includeEntries = c.req.query('include_entries') !== 'false'
  const includeSegments = c.req.query('include_segments') === 'true'
  const rec = await karuteService.getByRecordingSession(
    tenantId,
    c.req.param('recordingSessionId'),
    { includeEntries, includeSegments },
  )
  if (!rec) return c.json({ error: 'Karute record not found' }, 404)
  return c.json(rec)
})

karuteRoutes.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const includeEntries = c.req.query('include_entries') !== 'false'
  const includeSegments = c.req.query('include_segments') === 'true'
  const rec = await karuteService.getKaruteRecord(tenantId, c.req.param('id'), {
    includeEntries,
    includeSegments,
  })
  if (!rec) return c.json({ error: 'Karute record not found' }, 404)
  return c.json(rec)
})

karuteRoutes.post('/', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createKaruteRecordSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const rec = await karuteService.createKaruteRecord(tenantId, parsed.data)
  return c.json(rec, 201)
})

karuteRoutes.put('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateKaruteRecordSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const rec = await karuteService.updateKaruteRecord(tenantId, c.req.param('id'), parsed.data)
    return c.json(rec)
  } catch (err) {
    if (err instanceof Error && err.message === 'Karute record not found') {
      return c.json({ error: 'Karute record not found' }, 404)
    }
    throw err
  }
})

karuteRoutes.delete('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  try {
    await karuteService.deleteKaruteRecord(tenantId, c.req.param('id'))
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Karute record not found') {
      return c.json({ error: 'Karute record not found' }, 404)
    }
    throw err
  }
})
