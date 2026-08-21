import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as signals from '../services/retention-signal.service.js'
import { InvalidSignalError } from '../services/retention-signal.service.js'

export const retentionSignalRoutes = new Hono<AppEnv>()

const createSchema = z.object({
  occurred_at: z.string().datetime(),
  karute_record_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  criterion: z.enum(['A', 'B', 'C']),
  confidence: z.enum(['high', 'medium']),
  quote: z.string().min(1).max(2000),
  mentioned_business: z.string().max(200).nullable().optional(),
})

// The detection pass's write.
retentionSignalRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    return c.json(await signals.createSignal(businessId, parsed.data), 201)
  } catch (err) {
    if (err instanceof InvalidSignalError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// Business-scoped list; the app gates reads behind its dedicated capability.
retentionSignalRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const q = c.req.query()
  if (q.status !== undefined && q.status !== 'pending' && q.status !== 'confirmed') {
    return c.json({ error: 'status must be pending or confirmed' }, 400)
  }
  const page = q.page !== undefined ? Number(q.page) : undefined
  const pageSize = q.page_size !== undefined ? Number(q.page_size) : undefined
  if ((page !== undefined && (!Number.isInteger(page) || page < 1)) ||
      (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1))) {
    return c.json({ error: 'page and page_size must be positive integers' }, 400)
  }
  return c.json(
    await signals.listSignals(businessId, {
      status: q.status as 'pending' | 'confirmed' | undefined,
      page,
      page_size: pageSize,
    }),
  )
})

// Anonymized dismissal counters (no ids, no quote).
retentionSignalRoutes.get('/dismissal-counters', async (c) => {
  const businessId = c.get('businessId')
  return c.json(await signals.listDismissalCounters(businessId))
})

// Manager confirm — starts the retention clock. Idempotent.
retentionSignalRoutes.post('/:id/confirm', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const manager = typeof body.manager_staff_id === 'string' ? body.manager_staff_id : null
  if (!manager) return c.json({ error: 'manager_staff_id required' }, 400)
  try {
    const row = await signals.confirmSignal(businessId, c.req.param('id'), manager)
    if (!row) return c.json({ error: 'Signal not found' }, 404)
    return c.json(row)
  } catch (err) {
    if (err instanceof InvalidSignalError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// Dismiss: HARD delete + anonymized counter (one transaction).
retentionSignalRoutes.post('/:id/dismiss', async (c) => {
  const businessId = c.get('businessId')
  const res = await signals.dismissSignal(businessId, c.req.param('id'))
  if (!res.ok) return c.json({ error: 'Signal not found' }, 404)
  return c.json(res)
})

// Statutory / retention-clock delete: HARD delete, no counter.
retentionSignalRoutes.delete('/:id', async (c) => {
  const businessId = c.get('businessId')
  const res = await signals.deleteSignal(businessId, c.req.param('id'))
  if (!res.ok) return c.json({ error: 'Signal not found' }, 404)
  return c.json(res)
})

// Vercel Cron: daily expiry sweep (both statuses, all businesses).
// Auth via CRON_SECRET — same contract as /sync/cron/dispatch.
retentionSignalRoutes.get('/cron/sweep', async (c) => {
  const auth = c.req.header('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return c.json(await signals.sweepExpired())
})
