import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import { consumeAiRequest, recordAiUsage } from '../services/ai-rate-limit.service.js'

export const aiRateLimitRoutes = new Hono<AppEnv>()

aiRateLimitRoutes.post('/consume', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const route = typeof body.route === 'string' ? body.route : 'unknown'
  const result = await consumeAiRequest(businessId, route)
  return c.json(result)
})

aiRateLimitRoutes.post('/record-usage', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const route = typeof body.route === 'string' ? body.route : 'unknown'
  const tokensIn = typeof body.tokens_in === 'number' ? body.tokens_in : null
  const tokensOut = typeof body.tokens_out === 'number' ? body.tokens_out : null
  const costCents = typeof body.cost_cents === 'number' ? body.cost_cents : null
  await recordAiUsage(businessId, route, tokensIn, tokensOut, costCents)
  return c.json({ ok: true })
})
