import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as auditService from '../services/audit.service.js'
import { auditEventSchema } from '../validations/audit.js'

export const auditRoutes = new Hono<AppEnv>()


// NOT z.coerce.boolean(): Boolean('false') === true, so ?break_glass=false /
// ?exclude_views=false would silently mean true (same class as the menus fix).
const queryBool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional()

const listSchema = z.object({
  category: z.string().optional(),
  actor_id: z.string().uuid().optional(),
  actor_staff_ref: z.string().uuid().optional(),
  request_id: z.string().optional(),
  target_type: z.string().optional(),
  target_id: z.string().optional(),
  break_glass: queryBool,
  severity: z.enum(['info', 'warn', 'critical']).optional(),
  store_id: z.string().uuid().optional(),
  exclude_views: queryBool,
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
})

// POST /v1/audit — the ONE write endpoint (app + core both log through it).
auditRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = auditEventSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const event = await auditService.logEvent(businessId, parsed.data)
  return c.json(event, 201)
})

// GET /v1/audit — the 監査ログ read (owner-only surfaces on the app side).
auditRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await auditService.listAuditLog(businessId, parsed.data)
  return c.json(result)
})
