import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as policyService from '../services/store-policy.service.js'
import { requireHqAdmin, NotHqAdminError } from '../services/business-grant.service.js'
import { auditEventSchema } from '../validations/audit.js'

export const storePolicyRoutes = new Hono<AppEnv>()

const setSchema = z.object({
  booking_open_days: z.number().int().min(1).max(365).optional(),
  cutoff_minutes: z.number().int().min(0).max(10080).optional(),
  cancel_free_until_hours: z.number().int().min(0).max(720).optional(),
  cancel_late_pct: z.number().int().min(0).max(100).optional(),
  no_show_pct: z.number().int().min(0).max(100).optional(),
  acting_staff_id: z.string().uuid(),
  audit: auditEventSchema.optional(),
})

// Effective policies for every store (dashboard settings page).
storePolicyRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  return c.json({ policies: await policyService.listPolicies(businessId) })
})

// One store's effective policy (the BFF's calendar read).
storePolicyRoutes.get('/:storeId', async (c) => {
  const businessId = c.get('businessId')
  const policy = await policyService.getPolicy(businessId, c.req.param('storeId'))
  if (!policy) return c.json({ error: 'Store not found' }, 404)
  return c.json(policy)
})

// HQ-gated upsert; partial — omitted fields keep current values.
storePolicyRoutes.put('/:storeId', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = setSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const { acting_staff_id, audit, ...fields } = parsed.data
  try {
    await requireHqAdmin(businessId, acting_staff_id)
    const policy = await policyService.setPolicy(
      businessId,
      c.req.param('storeId'),
      { ...fields, updated_by: acting_staff_id },
      audit,
    )
    if (!policy) return c.json({ error: 'Store not found' }, 404)
    return c.json(policy)
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    throw err
  }
})
