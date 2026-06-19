import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as customerService from '../services/customer.service.js'

export const adminRoutes = new Hono<AppEnv>()

const backfillStoreSchema = z.object({ store_id: z.string().uuid() })

// POST /v1/admin/backfill-store  { store_id }
// One-time: stamp every unassigned (store_id null) event row in the business
// with the given store (the business's primary location). Idempotent.
adminRoutes.post('/backfill-store', async (c) => {
  const businessId = c.get('businessId')
  const parsed = backfillStoreSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  return c.json(await customerService.backfillStore(businessId, parsed.data.store_id))
})
