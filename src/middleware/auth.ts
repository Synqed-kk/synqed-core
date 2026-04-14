import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types/api.js'

const getApiKeys = (): Set<string> => {
  const keys = process.env.API_KEYS ?? ''
  return new Set(keys.split(',').map((k) => k.trim()).filter(Boolean))
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // Skip auth for health check
  if (c.req.path.endsWith('/health')) {
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
