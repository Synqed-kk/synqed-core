import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import { CustomerLinkError, getCustomerLinks, setCustomerLinks } from '../services/customer-links.service.js'
import { requireHqAdmin, NotHqAdminError } from '../services/business-grant.service.js'

export const customerLinkRoutes = new Hono<AppEnv>()
const input = z.object({ customer_ids: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length, 'Duplicate member'), acting_staff_id: z.string().uuid() }).strict()
customerLinkRoutes.get('/:id', async c => {
  const id = z.string().uuid().safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid customer id' }, 400)
  const result = await getCustomerLinks(c.get('businessId'), id.data)
  return result.customer_ids.length ? c.json(result) : c.json({ error: 'Customer not found' }, 404)
})
customerLinkRoutes.put('/:id', async c => {
  const id = z.string().uuid().safeParse(c.req.param('id'))
  const body = input.safeParse(await c.req.json().catch(() => null))
  if (!id.success || !body.success) return c.json({ error: 'Valid customer id, unique member IDs and actor required' }, 400)
  try {
    await requireHqAdmin(c.get('businessId'), body.data.acting_staff_id)
    return c.json(await setCustomerLinks(c.get('businessId'), id.data, body.data.customer_ids, body.data.acting_staff_id))
  } catch (error) {
    if (error instanceof NotHqAdminError) return c.json({ error: error.message }, 403)
    if (error instanceof CustomerLinkError) return c.json({ error: error.message }, 400)
    throw error
  }
})
