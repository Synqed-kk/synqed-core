import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import { consumeAiRequest } from '../services/ai-rate-limit.service.js'

export const aiRateLimitRoutes = new Hono<AppEnv>()

aiRateLimitRoutes.post('/consume', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const route = typeof body.route === 'string' ? body.route : 'unknown'
  const result = await consumeAiRequest(businessId, route)
  return c.json(result)
})
