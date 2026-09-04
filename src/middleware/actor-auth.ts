import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types/api.js'
import { answerSheet } from '../services/permission.service.js'
import { verifySupabaseAccessToken } from '../services/supabase-auth.service.js'

/**
 * Actor-aware auth for human writes. The API key still authenticates the BFF;
 * this layer verifies the forwarded Supabase access token and derives the
 * active staff card plus current core-owned capability sheet.
 */
export const actorAuthMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authorization = c.req.header('authorization')
  const match = authorization?.match(/^Bearer\s+(\S+)$/i)
  if (!match) return c.json({ error: 'Missing bearer token' }, 401)

  const userId = await verifySupabaseAccessToken(match[1])
  if (!userId) return c.json({ error: 'Invalid bearer token' }, 401)

  const sheet = await answerSheet(c.get('businessId'), userId)
  if (!sheet) return c.json({ error: 'Authenticated user is not an active staff member' }, 403)

  c.set('actor', {
    userId,
    staffId: sheet.staff_id,
    capabilities: sheet.capabilities,
    visibleStoreIds: sheet.visible_store_ids,
  })
  await next()
})
