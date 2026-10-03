import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import { runSyncSchema, syncProviderSchema, upsertSyncConfigSchema } from '../validations/sync.js'
import * as syncService from '../services/sync.service.js'

export const syncRoutes = new Hono<AppEnv>()

// GET|POST /v1/sync/cron/dispatch
// Called by Vercel Cron every 15 min. Auth via CRON_SECRET header,
// NOT the regular tenant-scoped API key — this is cross-tenant.
// GET is required: Vercel Cron invokes with GET, so the original POST-only
// route 404'd every tick and the schedule never actually ran. POST stays for
// manual/scripted dispatch.
syncRoutes.on(['GET', 'POST'], '/cron/dispatch', async (c) => {
  const auth = c.req.header('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const result = await syncService.dispatchCron()
  return c.json(result)
})

// GET /v1/sync/:provider/configs — one row per store, no secrets.
syncRoutes.get('/:provider/configs', async (c) => {
  const businessId = c.get('businessId')
  const providerParsed = syncProviderSchema.safeParse(c.req.param('provider').toUpperCase())
  if (!providerParsed.success) return c.json({ error: 'Invalid provider' }, 400)
  const configs = await syncService.listConfigs(businessId, providerParsed.data)
  return c.json({ configs })
})

// GET /v1/sync/:provider/config — kept for one client release: the primary
// store's row, or the only row (see defaultConfigStoreId).
syncRoutes.get('/:provider/config', async (c) => {
  const businessId = c.get('businessId')
  const providerParsed = syncProviderSchema.safeParse(c.req.param('provider').toUpperCase())
  if (!providerParsed.success) return c.json({ error: 'Invalid provider' }, 400)
  const storeId = await syncService.defaultConfigStoreId(businessId, providerParsed.data)
  const config = storeId && (await syncService.getConfig(businessId, providerParsed.data, storeId))
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

  try {
    const config = await syncService.upsertConfig(businessId, providerParsed.data, parsed.data)
    return c.json(config)
  } catch (err) {
    if (err instanceof syncService.SyncConfigError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// POST /v1/sync/:provider/run — manual "sync now"
//   { karute_store_id } → that row, flat SyncRunResult, 500 on failure.
//   { all: true }       → every row, 200 { results } (per-row ok/error).
//   no body             → the primary store's row (one client release), flat.
syncRoutes.post('/:provider/run', async (c) => {
  const businessId = c.get('businessId')
  const providerParsed = syncProviderSchema.safeParse(c.req.param('provider').toUpperCase())
  if (!providerParsed.success) return c.json({ error: 'Invalid provider' }, 400)
  const provider = providerParsed.data

  // Today's client sends no body: treat a missing/unparseable body as {}.
  const body = await c.req.json().catch(() => ({}))
  const parsed = runSyncSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  try {
    if (parsed.data.all) {
      return c.json(await syncService.runAllForBusiness(businessId, provider))
    }
    const storeId =
      parsed.data.karute_store_id ?? (await syncService.defaultConfigStoreId(businessId, provider))
    if (!storeId) throw new Error('Sync config not found')
    const result = await syncService.runSyncForTenant(businessId, provider, storeId)
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    return c.json({ error: message }, 500)
  }
})
