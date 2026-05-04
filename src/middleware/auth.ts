import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types/api.js'

const getApiKeys = (): Set<string> => {
  const keys = process.env.API_KEYS ?? ''
  return new Set(keys.split(',').map((k) => k.trim()).filter(Boolean))
}

// Paths that don't require business scoping — cron dispatch, health, anything
// that operates across businesses. These do their own auth (e.g. CRON_SECRET).
const CROSS_BUSINESS_PATHS = [
  /\/health$/,
  /\/v1\/sync\/cron\/dispatch$/,
]

function isCrossBusinessPath(path: string): boolean {
  return CROSS_BUSINESS_PATHS.some((re) => re.test(path))
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const path = c.req.path
  if (isCrossBusinessPath(path)) {
    return next()
  }

  const apiKey = c.req.header('x-api-key')
  if (!apiKey || !getApiKeys().has(apiKey)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const businessId = c.req.header('x-business-id')
  if (!businessId) {
    return c.json({ error: 'Missing x-business-id header' }, 400)
  }

  c.set('businessId', businessId)
  await next()
})
