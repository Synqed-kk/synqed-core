import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as discardService from '../services/recording-discard.service.js'
import {
  DiscardConfirmationForbiddenError,
  InvalidDiscardError,
} from '../services/recording-discard.service.js'
import { actorAuthMiddleware } from '../middleware/actor-auth.js'

export const recordingDiscardRoutes = new Hono<AppEnv>()

const createSchema = z
  .object({
    recording_session_id: z.string().uuid().nullable().optional(),
    karute_record_id: z.string().uuid().nullable().optional(),
    source: z.enum(['STAFF', 'SYSTEM']),
    discarded_by: z.string().uuid().nullable().optional(),
    reason: z.string().max(2000).nullable().optional(),
  })
  .refine((input) => input.recording_session_id != null || input.karute_record_id != null, {
    message: 'recording_session_id or karute_record_id is required',
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

const confirmationSchema = z.object({}).strict()

const listSchema = z.object({
  recording_session_id: z.string().uuid().optional(),
  recording_session_ids: z.string().max(7_500).optional().transform((value, ctx) => {
    if (!value) return undefined
    const ids = value.split(',').filter(Boolean)
    if (ids.length > 200 || ids.some((id) => !z.string().uuid().safeParse(id).success)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'recording_session_ids must contain at most 200 UUIDs' })
      return z.NEVER
    }
    return ids
  }),
  source: z.enum(['STAFF', 'SYSTEM']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
}).refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
  message: 'from must be before or equal to to',
})

// Immutable manager acknowledgement. Actor and timestamp are derived by core;
// this endpoint intentionally accepts no mutable discard fields.
recordingDiscardRoutes.put('/:id/confirmation', actorAuthMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = confirmationSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    return c.json(
      await discardService.confirmDiscardEvent(
        c.get('businessId'),
        c.req.param('id'),
        c.get('actor'),
      ),
    )
  } catch (err) {
    if (err instanceof DiscardConfirmationForbiddenError) {
      return c.json({ error: err.message }, 403)
    }
    if (err instanceof InvalidDiscardError && err.message === 'Discard event not found.') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// Ledger read: by session, by source, or the business-wide stream (paged).
recordingDiscardRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const parsed = listSchema.safeParse(c.req.query())
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await discardService.listDiscardEvents(businessId, parsed.data)
  return c.json(result)
})
