import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as grants from '../services/business-grant.service.js'
import { NotHqAdminError } from '../services/business-grant.service.js'

export const businessGrantRoutes = new Hono<AppEnv>()

const addSchema = z.object({
  staff_id: z.string().uuid(),
  grant: z.enum(['HQ_ADMIN']),
  acting_staff_id: z.string().uuid(),
})

// Live grants for the business (the HQ roster).
businessGrantRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  return c.json({ grants: await grants.listGrants(businessId) })
})

// Capability probe — the dashboard asks "can this staff manage org settings?".
businessGrantRoutes.get('/check', async (c) => {
  const businessId = c.get('businessId')
  const staffId = c.req.query('staff_id')
  const grant = c.req.query('grant') ?? 'HQ_ADMIN'
  if (!staffId) return c.json({ error: 'staff_id required' }, 400)
  if (grant !== 'HQ_ADMIN') return c.json({ error: 'Unknown grant' }, 400)
  return c.json({ granted: await grants.hasGrant(businessId, staffId, grant) })
})

businessGrantRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = addSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    return c.json(await grants.addGrant(businessId, parsed.data), 201)
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

businessGrantRoutes.delete('/:id', async (c) => {
  const businessId = c.get('businessId')
  const acting = c.req.query('acting_staff_id')
  if (!acting) return c.json({ error: 'acting_staff_id required' }, 400)
  try {
    return c.json(await grants.revokeGrant(businessId, c.req.param('id'), acting))
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    throw err
  }
})
