import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import { syncProviderSchema, upsertSyncConfigSchema } from '../validations/sync.js'
import * as syncService from '../services/sync.service.js'

export const syncRoutes = new Hono<AppEnv>()

// POST /v1/sync/cron/dispatch
// Called by Vercel Cron every 15 min. Auth via CRON_SECRET header,
// NOT the regular tenant-scoped API key — this is cross-tenant.
syncRoutes.post('/cron/dispatch', async (c) => {
  const auth = c.req.header('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const result = await syncService.dispatchCron()
  return c.json(result)
})

// GET /v1/sync/:provider/config
syncRoutes.get('/:provider/config', async (c) => {
  const businessId = c.get('businessId')
  const providerParsed = syncProviderSchema.safeParse(c.req.param('provider').toUpperCase())
  if (!providerParsed.success) return c.json({ error: 'Invalid provider' }, 400)
  const config = await syncService.getConfig(businessId, providerParsed.data)
  if (!config) return c.json({ error: 'Not configured' }, 404)
  return c.json(config)
})

// PUT /v1/sync/:provider/config
syncRoutes.put('/:provider/config', async (c) => {
  const businessId = c.get('businessId')
  const providerParsed = syncProviderSchema.safeParse(c.req.param('provider').toUpperCase())
  if (!providerParsed.success) return c.json({ error: 'Invalid provider' }, 400)

  const body = await c.req.json().catch(() => ({}))
  const parsed = upsertSyncConfigSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  const config = await syncService.upsertConfig(businessId, providerParsed.data, parsed.data)
  return c.json(config)
})

// POST /v1/sync/:provider/run — manual "sync now"
syncRoutes.post('/:provider/run', async (c) => {
  const businessId = c.get('businessId')
  const providerParsed = syncProviderSchema.safeParse(c.req.param('provider').toUpperCase())
  if (!providerParsed.success) return c.json({ error: 'Invalid provider' }, 400)

  try {
    const result = await syncService.runSyncForTenant(businessId, providerParsed.data)
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    return c.json({ error: message }, 500)
  }
})
