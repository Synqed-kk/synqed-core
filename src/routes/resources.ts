import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as resourceService from '../services/resource.service.js'
import { InvalidResourceError } from '../services/resource.service.js'

export const resourceRoutes = new Hono<AppEnv>()

const createSchema = z.object({
  store_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  note: z.string().max(500).nullable().optional(),
  room_class: z.enum(['standard', 'private']).optional(),
  cleanup_minutes: z.number().int().min(0).max(240).optional(),
  display_order: z.number().int().min(0).optional(),
})

const updateSchema = createSchema
  .omit({ store_id: true })
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict()

// The bed roster (store filter for the day board).
resourceRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const q = c.req.query()
  let active: boolean | undefined
  if (q.active !== undefined) {
    if (q.active !== 'true' && q.active !== 'false') {
      return c.json({ error: 'active must be true or false' }, 400)
    }
    active = q.active === 'true'
  }
  return c.json(await resourceService.listResources(businessId, { store_id: q.store_id, active }))
})

resourceRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    return c.json(await resourceService.createResource(businessId, parsed.data), 201)
  } catch (err) {
    if (err instanceof InvalidResourceError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// No DELETE — resources retire via active:false (bookings reference them forever).
resourceRoutes.patch('/:id', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const row = await resourceService.updateResource(businessId, c.req.param('id'), parsed.data)
  if (!row) return c.json({ error: 'Resource not found' }, 404)
  return c.json(row)
})
