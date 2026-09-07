import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import { getStaffBadgeDefinitions, setStaffBadgeDefinitions } from '../services/customer-badge.service.js'
import { requireHqAdmin, NotHqAdminError } from '../services/business-grant.service.js'

export const customerBadgeRoutes = new Hono<AppEnv>()
const setSchema = z.object({
  badges: z.array(z.object({ name: z.string().trim().min(1).max(100), colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    display_order: z.number().int().min(0).max(10000) }).strict()).max(100)
    .refine(badges => new Set(badges.map(b => b.name)).size === badges.length, 'Badge names must be unique'),
  acting_staff_id: z.string().uuid(),
}).strict()

customerBadgeRoutes.get('/', async c => c.json({ badges: await getStaffBadgeDefinitions(c.get('businessId')) }))
customerBadgeRoutes.put('/', async c => {
  const parsed = setSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    await requireHqAdmin(c.get('businessId'), parsed.data.acting_staff_id)
    return c.json({ badges: await setStaffBadgeDefinitions(c.get('businessId'), parsed.data.badges, parsed.data.acting_staff_id) })
  } catch (error) {
    if (error instanceof NotHqAdminError) return c.json({ error: error.message }, 403)
    throw error
  }
})
