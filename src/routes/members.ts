import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import { actorAuthMiddleware } from '../middleware/actor-auth.js'
import { verifySupabaseAccessToken } from '../services/supabase-auth.service.js'
import { prisma } from '../db/client.js'
import { createMemberAccount, memberAccount, dailyOpen, pointLedger, recordPointsIn, MemberPointsError } from '../services/member-points.service.js'
import { logEventIn } from '../services/audit.service.js'

export const memberRoutes = new Hono<AppEnv>()
export const memberPointAdminRoutes = new Hono<AppEnv>()
function handleError(error: Error, c: Context<AppEnv>) {
  if (error instanceof MemberPointsError) return c.json({ code: error.code, error: error.message }, error.code === 'NOT_FOUND' ? 404 : error.code === 'VALIDATION' ? 400 : 409)
  throw error
}
memberRoutes.onError(handleError)
memberPointAdminRoutes.onError(handleError)

// The BFF holds the API key; the forwarded bearer establishes the member.
memberRoutes.use('*', async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return c.json({ code: 'AUTH_REQUIRED' }, 401)
  const userId = await verifySupabaseAccessToken(token)
  if (!userId) return c.json({ code: 'AUTH_REQUIRED' }, 401)
  c.set('memberUserId', userId)
  await next()
})
memberRoutes.post('/me', async c => {
  const input = z.object({ displayName: z.string().trim().min(1).max(120) }).strict().safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ code: 'VALIDATION' }, 400)
  const account = await createMemberAccount(c.get('memberUserId'), input.data.displayName)
  return c.json({ accountId: account.id, displayName: account.displayName }, 201)
})
memberRoutes.get('/me', async c => {
  const account = await memberAccount(c.get('memberUserId'))
  return c.json({ accountId: account.id, displayName: account.displayName })
})
memberRoutes.post('/me/claim', c => c.json({ code: 'CLAIM_NOT_IMPLEMENTED', error: 'Existing customer linking awaits design.' }, 501))

const storeIdSchema = z.string().uuid()
memberRoutes.get('/me/stores/:storeId/points', async c => {
  const account = await memberAccount(c.get('memberUserId'))
  const storeId = storeIdSchema.safeParse(c.req.param('storeId'))
  if (!storeId.success) return c.json({ code: 'VALIDATION' }, 400)
  return c.json(await pointLedger({ accountId: account.id, storeId: storeId.data, businessId: c.get('businessId') }, c.req.query('cursor'), Number(c.req.query('limit') ?? 50)))
})
memberRoutes.post('/me/stores/:storeId/daily-open', async c => {
  const account = await memberAccount(c.get('memberUserId'))
  const storeId = storeIdSchema.safeParse(c.req.param('storeId'))
  if (!storeId.success) return c.json({ code: 'VALIDATION' }, 400)
  return c.json(await dailyOpen({ accountId: account.id, storeId: storeId.data, businessId: c.get('businessId') }))
})

memberPointAdminRoutes.use('*', actorAuthMiddleware)
memberPointAdminRoutes.use('/stores/:storeId/*', async (c, next) => {
  const storeId = storeIdSchema.safeParse(c.req.param('storeId'))
  const actor = c.get('actor')
  if (!storeId.success) return c.json({ code: 'VALIDATION' }, 400)
  if (actor.visibleStoreIds && !actor.visibleStoreIds.includes(storeId.data)) return c.json({ code: 'NOT_FOUND' }, 404)
  const store = await prisma.store.findFirst({ where: { id: storeId.data, businessId: c.get('businessId'), active: true } })
  if (!store) return c.json({ code: 'NOT_FOUND' }, 404)
  await next()
})
memberPointAdminRoutes.put('/stores/:storeId/policy', async c => {
  const actor = c.get('actor')
  if (!actor.capabilities.includes('settings.manage')) return c.json({ code: 'FORBIDDEN' }, 403)
  const parsed = z.object({ dailyOpenPoints: z.number().int().min(0).max(1000) }).strict().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ code: 'VALIDATION' }, 400)
  const businessId = c.get('businessId'), storeId = c.req.param('storeId')
  const policy = await prisma.$transaction(async tx => {
    const policy = await tx.storePointPolicy.upsert({ where: { storeId }, create: { storeId, businessId, ...parsed.data }, update: parsed.data })
    await logEventIn(tx, businessId, { actor_type: 'staff', actor_id: actor.userId, actor_staff_ref: actor.staffId,
      category: 'settings', action: 'update_points_policy', target_type: 'store', target_id: storeId, detail: parsed.data })
    return policy
  })
  return c.json({ dailyOpenPoints: policy.dailyOpenPoints })
})
memberPointAdminRoutes.post('/stores/:storeId/adjustments', async c => {
  const actor = c.get('actor')
  if (!actor.capabilities.includes('billing.manage')) return c.json({ code: 'FORBIDDEN' }, 403)
  const parsed = z.object({ accountId: z.string().uuid(), amount: z.number().int().min(-2147483647).max(2147483647).refine(n => n !== 0), reason: z.string().trim().min(1).max(200) }).strict().safeParse(await c.req.json().catch(() => null))
  const eventRef = z.string().uuid().safeParse(c.req.header('Idempotency-Key'))
  if (!parsed.success || !eventRef.success) return c.json({ code: 'VALIDATION' }, 400)
  const result = await prisma.$transaction(tx => recordPointsIn(tx, { ...parsed.data, businessId: c.get('businessId'), storeId: c.req.param('storeId'),
    source: 'ADMIN_ADJUST', eventRef: eventRef.data, actorId: actor.userId }))
  return c.json({ entryId: result.entry.id, balance: result.balance, replayed: result.replayed })
})
