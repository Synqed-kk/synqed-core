import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import * as aiCache from '../services/ai-cache.service.js'

// Global AI cache — API-key-gated but BUSINESS-OPTIONAL (see middleware/auth.ts).
export const aiCacheRoutes = new Hono<AppEnv>()

// Cross-business maintenance (cron) — delete expired. Declared before /:key.
aiCacheRoutes.post('/cleanup', async (c) => {
  return c.json(await aiCache.cleanupExpired())
})

aiCacheRoutes.get('/:key', async (c) => {
  const result = await aiCache.getCache(c.req.param('key'))
  if (result === null) return c.json({ error: 'miss' }, 404)
  return c.json({ result })
})

aiCacheRoutes.put('/', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.cache_key !== 'string' || typeof b.expires_at !== 'string' || !('result' in b)) {
    return c.json({ error: 'cache_key, result, expires_at required' }, 400)
  }
  return c.json(await aiCache.upsertCache(b.cache_key, b.result, b.expires_at))
})
