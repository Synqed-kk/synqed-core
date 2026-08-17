import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as discardService from '../services/recording-discard.service.js'
import { InvalidDiscardError } from '../services/recording-discard.service.js'

export const recordingDiscardRoutes = new Hono<AppEnv>()

const createSchema = z.object({
  recording_session_id: z.string().uuid(),
  source: z.enum(['STAFF', 'SYSTEM']),
  discarded_by: z.string().uuid().nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
})

// One row per discard. Returns the row id — the app puts THAT in its audit
// detail; the written reason itself is content and stays here.
recordingDiscardRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    return c.json(await discardService.recordDiscardEvent(businessId, parsed.data), 201)
  } catch (err) {
    if (err instanceof InvalidDiscardError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// Ledger read: by session, by source, or the business-wide stream (paged).
recordingDiscardRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const q = c.req.query()
  if (q.source !== undefined && q.source !== 'STAFF' && q.source !== 'SYSTEM') {
    return c.json({ error: 'source must be STAFF or SYSTEM' }, 400)
  }
  const page = q.page !== undefined ? Number(q.page) : undefined
  const pageSize = q.page_size !== undefined ? Number(q.page_size) : undefined
  if ((page !== undefined && (!Number.isInteger(page) || page < 1)) ||
      (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1))) {
    return c.json({ error: 'page and page_size must be positive integers' }, 400)
  }
  const result = await discardService.listDiscardEvents(businessId, {
    recording_session_id: q.recording_session_id,
    source: q.source as 'STAFF' | 'SYSTEM' | undefined,
    page,
    page_size: pageSize,
  })
  return c.json(result)
})
