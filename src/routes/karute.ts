import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import {
  createKaruteRecordSchema,
  updateKaruteRecordSchema,
  listKaruteRecordsSchema,
  listEntryEditsSchema,
  entryInputSchema,
  entryMutationMetaSchema,
  updateEntrySchema,
} from '../validations/karute.js'
import * as karuteService from '../services/karute.service.js'

export const karuteRoutes = new Hono<AppEnv>()

karuteRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listKaruteRecordsSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await karuteService.listKaruteRecords(businessId, parsed.data)
  return c.json(result)
})

// Lookup by recording_session_id — comes BEFORE /:id so the path segment
// doesn't eat "by-recording".
karuteRoutes.get('/by-recording/:recordingSessionId', async (c) => {
  const businessId = c.get('businessId')
  const includeEntries = c.req.query('include_entries') !== 'false'
  const includeSegments = c.req.query('include_segments') === 'true'
  const rec = await karuteService.getByRecordingSession(
    businessId,
    c.req.param('recordingSessionId'),
    { includeEntries, includeSegments },
  )
  if (!rec) return c.json({ error: 'Karute record not found' }, 404)
  return c.json(rec)
})

// The 監査ログ read (owner-only surfaces on the app side). BEFORE /:id so the
// path segment doesn't eat "entry-edits".
karuteRoutes.get('/entry-edits', async (c) => {
  const businessId = c.get('businessId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listEntryEditsSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await karuteService.listEntryEdits(businessId, parsed.data)
  return c.json(result)
})

karuteRoutes.get('/:id', async (c) => {
  const businessId = c.get('businessId')
  const includeEntries = c.req.query('include_entries') !== 'false'
  const includeSegments = c.req.query('include_segments') === 'true'
  const rec = await karuteService.getKaruteRecord(businessId, c.req.param('id'), {
    includeEntries,
    includeSegments,
  })
  if (!rec) return c.json({ error: 'Karute record not found' }, 404)
  return c.json(rec)
})

karuteRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createKaruteRecordSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const rec = await karuteService.createKaruteRecord(businessId, parsed.data)
  return c.json(rec, 201)
})

karuteRoutes.put('/:id', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateKaruteRecordSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const rec = await karuteService.updateKaruteRecord(businessId, c.req.param('id'), parsed.data)
    return c.json(rec)
  } catch (err) {
    if (err instanceof Error && err.message === 'Karute record not found') {
      return c.json({ error: 'Karute record not found' }, 404)
    }
    throw err
  }
})

karuteRoutes.delete('/:id', async (c) => {
  const businessId = c.get('businessId')
  try {
    await karuteService.deleteKaruteRecord(businessId, c.req.param('id'))
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Karute record not found') {
      return c.json({ error: 'Karute record not found' }, 404)
    }
    throw err
  }
})

karuteRoutes.post('/:id/entries', async (c) => {
  const businessId = c.get('businessId')
  const karuteRecordId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = entryInputSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const meta = entryMutationMetaSchema.safeParse(body)
  try {
    const entry = await karuteService.addEntry(
      businessId,
      karuteRecordId,
      parsed.data,
      meta.success ? meta.data : {},
    )
    return c.json(entry, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'Karute record not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// Edit an entry in place — same id, history preserved. expected_version is
// mandatory; a stale version returns 409 with the current version so the
// editor can reload-and-retry.
karuteRoutes.patch('/:id/entries/:entryId', async (c) => {
  const businessId = c.get('businessId')
  const karuteRecordId = c.req.param('id')
  const entryId = c.req.param('entryId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateEntrySchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const { actor_staff_id, action, prompt_version, model, ...patch } = parsed.data
  try {
    const entry = await karuteService.updateEntry(
      businessId,
      karuteRecordId,
      entryId,
      patch,
      { actor_staff_id, action, prompt_version, model },
    )
    return c.json(entry)
  } catch (err) {
    if (err instanceof karuteService.StaleEntryVersionError) {
      return c.json(
        { error: err.message, current_version: err.currentVersion },
        409,
      )
    }
    if (
      err instanceof Error &&
      (err.message === 'Karute record not found' || err.message === 'Entry not found')
    ) {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

karuteRoutes.delete('/:id/entries/:entryId', async (c) => {
  const businessId = c.get('businessId')
  const karuteRecordId = c.req.param('id')
  const entryId = c.req.param('entryId')
  const meta = entryMutationMetaSchema.safeParse({
    actor_staff_id: c.req.query('actor_staff_id'),
    action: c.req.query('action'),
  })
  try {
    await karuteService.deleteEntry(
      businessId,
      karuteRecordId,
      entryId,
      meta.success ? meta.data : {},
    )
    return c.json({ success: true })
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === 'Karute record not found' || err.message === 'Entry not found')
    ) {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})
