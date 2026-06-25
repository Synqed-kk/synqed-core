import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import * as entitlementService from '../services/entitlement.service.js'

export const entitlementRoutes = new Hono<AppEnv>()

// Per-tenant singleton — the caller's plan tier + unlimited override.
entitlementRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const entitlement = await entitlementService.getEntitlement(businessId)
  return c.json(entitlement)
})

entitlementRoutes.put('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const entitlement = await entitlementService.upsertEntitlement(businessId, {
    tier: typeof body.tier === 'string' ? body.tier : undefined,
    is_unlimited: typeof body.is_unlimited === 'boolean' ? body.is_unlimited : undefined,
  })
  return c.json(entitlement)
})
