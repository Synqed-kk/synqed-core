import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import { upsertOrgSettingsSchema } from '../validations/org-settings.js'
import * as orgSettingsService from '../services/org-settings.service.js'

export const orgSettingsRoutes = new Hono<AppEnv>()

// Per-tenant singleton — no list, no :id.
orgSettingsRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const settings = await orgSettingsService.getOrgSettings(tenantId)
  if (!settings) return c.json({ error: 'Not configured' }, 404)
  return c.json(settings)
})

orgSettingsRoutes.put('/', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = upsertOrgSettingsSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const settings = await orgSettingsService.upsertOrgSettings(tenantId, parsed.data)
  return c.json(settings)
})
