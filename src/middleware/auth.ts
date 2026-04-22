import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types/api.js'

const getApiKeys = (): Set<string> => {
  const keys = process.env.API_KEYS ?? ''
  return new Set(keys.split(',').map((k) => k.trim()).filter(Boolean))
}

// Paths that don't require tenant scoping — cron dispatch, health, anything
// that operates across tenants. These do their own auth (e.g. CRON_SECRET).
const CROSS_TENANT_PATHS = [
  /\/health$/,
  /\/v1\/sync\/cron\/dispatch$/,
]

function isCrossTenantPath(path: string): boolean {
  return CROSS_TENANT_PATHS.some((re) => re.test(path))
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const path = c.req.path
  if (isCrossTenantPath(path)) {
    return next()
  }

  const apiKey = c.req.header('x-api-key')
  if (!apiKey || !getApiKeys().has(apiKey)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const tenantId = c.req.header('x-tenant-id')
  if (!tenantId) {
    return c.json({ error: 'Missing x-tenant-id header' }, 400)
  }

  c.set('tenantId', tenantId)
  await next()
})
