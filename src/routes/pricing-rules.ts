import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as pricing from '../services/pricing.service.js'
import { requireHqAdmin, NotHqAdminError } from '../services/business-grant.service.js'

export const pricingRuleRoutes = new Hono<AppEnv>()

const hourKey = z.string().regex(/^(1?[0-9]|2[0-3])$/)
const multiplier = z.number().min(0).max(5)
const dayGrid = z.record(hourKey, multiplier)
const rulesSchema = z
  .object({
    grid: z
      .object({
        sun: dayGrid.optional(), mon: dayGrid.optional(), tue: dayGrid.optional(),
        wed: dayGrid.optional(), thu: dayGrid.optional(), fri: dayGrid.optional(),
        sat: dayGrid.optional(),
      })
      .strict()
      .optional(),
    promos: z
      .array(
        z
          .object({
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            multiplier,
            label: z.string().max(100).optional(),
          })
          .refine((p) => p.from <= p.to, { message: 'promo from must be <= to' }),
      )
      .max(50)
      .optional(),
    flex: z.number().int().min(0).max(10).optional(),
  })
  .strict()

const saveSchema = z.object({
  store_id: z.string().uuid(),
  menu_id: z.string().uuid().nullable().optional(),
  rules: rulesSchema,
  acting_staff_id: z.string().uuid(),
})

// The BFF's read: every ACTIVE set for a store in one call.
pricingRuleRoutes.get('/active', async (c) => {
  const businessId = c.get('businessId')
  const storeId = c.req.query('store_id')
  if (!storeId) return c.json({ error: 'store_id required' }, 400)
  return c.json({ rule_sets: await pricing.listActive(businessId, storeId) })
})

// Version history for one scope (rollback picker).
pricingRuleRoutes.get('/history', async (c) => {
  const businessId = c.get('businessId')
  const storeId = c.req.query('store_id')
  if (!storeId) return c.json({ error: 'store_id required' }, 400)
  const menuId = c.req.query('menu_id') ?? null
  return c.json({ rule_sets: await pricing.history(businessId, storeId, menuId) })
})

// Save a new version (supersedes the current ACTIVE for the scope). HQ-gated.
pricingRuleRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    await requireHqAdmin(businessId, parsed.data.acting_staff_id)
    const saved = await pricing.saveRuleSet(businessId, {
      store_id: parsed.data.store_id,
      menu_id: parsed.data.menu_id ?? null,
      rules: parsed.data.rules,
      created_by: parsed.data.acting_staff_id,
    })
    return c.json(saved, 201)
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    if (err instanceof Error && (err.message === 'Store not found' || err.message === 'Menu not found')) {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// One-click rollback: re-issues the chosen version as a new ACTIVE one. HQ-gated.
pricingRuleRoutes.post('/:id/rollback', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const acting = typeof body.acting_staff_id === 'string' ? body.acting_staff_id : null
  if (!acting) return c.json({ error: 'acting_staff_id required' }, 400)
  try {
    await requireHqAdmin(businessId, acting)
    return c.json(await pricing.rollback(businessId, c.req.param('id'), acting), 201)
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    if (err instanceof Error && err.message === 'Rule set not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})
