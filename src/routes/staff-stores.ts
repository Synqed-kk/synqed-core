import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import * as staffStoreService from '../services/staff-store.service.js'

export const staffStoreRoutes = new Hono<AppEnv>()

// Per-store staff counts for the business (used by the stores list).
staffStoreRoutes.get('/counts', async (c) => {
  const businessId = c.get('businessId')
  const counts = await staffStoreService.staffCountsByStore(businessId)
  return c.json({ counts })
})

// The store ids a staff member is assigned to.
staffStoreRoutes.get('/:staffId', async (c) => {
  const businessId = c.get('businessId')
  const storeIds = await staffStoreService.getStaffStores(businessId, c.req.param('staffId'))
  return c.json({ store_ids: storeIds })
})

// Replace a staff member's full store set.
staffStoreRoutes.put('/:staffId', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const storeIds = Array.isArray(body.store_ids)
    ? body.store_ids.filter((s: unknown): s is string => typeof s === 'string')
    : []
  try {
    await staffStoreService.setStaffStores(businessId, c.req.param('staffId'), storeIds)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed' }, 400)
  }
})
