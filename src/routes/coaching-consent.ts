import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../db/client.js'
import type { AppEnv } from '../types/api.js'
import { verifySupabaseAccessToken } from '../services/supabase-auth.service.js'
import { answerSheet } from '../services/permission.service.js'
import { appendConsent, consentAdoption, CoachingConsentError, ownConsent, ownConsentHistory } from '../services/coaching-consent.service.js'

export const coachingConsentRoutes = new Hono<AppEnv>()

coachingConsentRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  const token = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  const userId = token ? await verifySupabaseAccessToken(token) : null
  if (!userId) return c.json({ error: 'Verified staff login required' }, 401)
  // Authentication resolves ONLY user_id, never an arbitrary matching card id.
  const staff = await prisma.staff.findFirst({ where: { businessId: c.get('businessId'), userId, isActive: true } })
  if (!staff) return c.json({ error: 'Active staff login required' }, 403)
  const sheet = await answerSheet(c.get('businessId'), staff.id)
  if (!sheet || sheet.staff_id !== staff.id) return c.json({ error: 'Staff identity is ambiguous' }, 403)
  c.set('actor', { userId, staffId: staff.id, capabilities: sheet.capabilities, visibleStoreIds: sheet.visible_store_ids })
  await next()
})

coachingConsentRoutes.onError((error, c) => {
  if (error instanceof CoachingConsentError) return c.json({ error: error.message }, error.status)
  throw error
})

coachingConsentRoutes.get('/me', async c => c.json(await ownConsent(c.get('businessId'), c.get('actor').staffId, c.get('actor').userId)))

coachingConsentRoutes.post('/me', async c => {
  const input = z.object({ status: z.enum(['granted', 'declined']), policy_version: z.string().min(1).max(200) }).strict()
    .safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid consent decision' }, 400)
  const actor = c.get('actor')
  return c.json(await appendConsent(c.get('businessId'), actor.staffId, actor.userId, input.data), 201)
})

coachingConsentRoutes.get('/me/history', async c => {
  const cursor = z.string().uuid().optional()
    .safeParse(c.req.query('cursor'))
  if (!cursor.success) return c.json({ error: 'Invalid cursor' }, 400)
  return c.json(await ownConsentHistory(c.get('businessId'), c.get('actor').staffId, c.get('actor').userId, cursor.data))
})

coachingConsentRoutes.get('/stores/:storeId/adoption', async c => {
  const storeId = z.string().uuid().safeParse(c.req.param('storeId'))
  if (!storeId.success) return c.json({ error: 'Invalid store' }, 400)
  const actor = c.get('actor')
  if (!actor.capabilities.includes('analytics.viewAll')) return c.json({ error: 'Forbidden' }, 403)
  if (actor.visibleStoreIds && !actor.visibleStoreIds.includes(storeId.data)) return c.json({ error: 'Store not found' }, 404)
  return c.json(await consentAdoption(c.get('businessId'), storeId.data))
})
