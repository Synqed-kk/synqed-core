import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db/client.js'

export class MemberPointsError extends Error {
  constructor(public code: 'NOT_FOUND' | 'INSUFFICIENT_POINTS' | 'EVENT_CONFLICT' | 'VALIDATION') { super(code) }
}

export async function createMemberAccount(authUserId: string, displayName: string) {
  const account = await prisma.memberAccount.upsert({ where: { authUserId }, update: { authUserId }, create: { authUserId, displayName } })
  if (account.deletedAt) throw new MemberPointsError('NOT_FOUND')
  return account
}
export async function memberAccount(authUserId: string) {
  const account = await prisma.memberAccount.findFirst({ where: { authUserId, deletedAt: null } })
  if (!account) throw new MemberPointsError('NOT_FOUND')
  return account
}

const pointEventSchema = z.object({
  accountId: z.string().uuid(), businessId: z.string().uuid(), storeId: z.string().uuid(),
  source: z.enum(['DAILY_OPEN', 'VISIT_CHECKIN', 'CONTENT_READ', 'REFERRAL_REFERRER', 'REFERRAL_FRIEND', 'DISCOUNT_REDEMPTION', 'ADMIN_ADJUST']),
  eventRef: z.string().min(1).max(200), amount: z.number().int().min(-2147483647).max(2147483647).refine(n => n !== 0),
  actorId: z.string().uuid().optional(), reason: z.string().max(200).optional(),
})
type PointEvent = z.infer<typeof pointEventSchema>
type Scope = Pick<PointEvent, 'accountId' | 'businessId' | 'storeId'>

async function lockWallet(tx: Prisma.TransactionClient, scope: Scope) {
  // Account deletion and store reassignment cannot race creation of a wallet.
  const accounts = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM member_accounts WHERE id=${scope.accountId}::uuid AND deleted_at IS NULL FOR SHARE`
  const stores = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stores WHERE id=${scope.storeId}::uuid AND business_id=${scope.businessId}::uuid AND active=true FOR SHARE`
  if (!accounts.length || !stores.length) throw new MemberPointsError('NOT_FOUND')
  await tx.$executeRaw`INSERT INTO point_wallets(id,account_id,business_id,store_id) VALUES (gen_random_uuid(),${scope.accountId}::uuid,${scope.businessId}::uuid,${scope.storeId}::uuid) ON CONFLICT (account_id,store_id) DO NOTHING`
  const [wallet] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM point_wallets WHERE account_id=${scope.accountId}::uuid AND store_id=${scope.storeId}::uuid AND business_id=${scope.businessId}::uuid FOR UPDATE`
  if (!wallet) throw new MemberPointsError('NOT_FOUND')
  return wallet
}
async function balanceIn(tx: Prisma.TransactionClient, walletId: string) {
  const result = await tx.pointEntry.aggregate({ where: { walletId }, _sum: { amount: true } })
  const balance = result._sum.amount ?? 0
  if (!Number.isSafeInteger(balance)) throw new Error('Points balance exceeds safe integer range')
  return balance
}

/** Trusted server event only. Call inside the source event's transaction so a
 * check-in, burn, or order and its points commit together. No member amount API. */
export async function recordPointsIn(tx: Prisma.TransactionClient, raw: PointEvent) {
  const parsed = pointEventSchema.safeParse(raw)
  if (!parsed.success) throw new MemberPointsError('VALIDATION')
  const input = parsed.data
  if ((input.source === 'DISCOUNT_REDEMPTION' && input.amount > 0)
    || (!['DISCOUNT_REDEMPTION', 'ADMIN_ADJUST'].includes(input.source) && input.amount < 0)) throw new MemberPointsError('VALIDATION')
  const wallet = await lockWallet(tx, input)
  const previous = await tx.pointEntry.findUnique({ where: { walletId_source_eventRef: { walletId: wallet.id, source: input.source, eventRef: input.eventRef } } })
  if (previous) {
    if (previous.amount !== input.amount || previous.actorId !== (input.actorId ?? null) || previous.reason !== (input.reason ?? null)) throw new MemberPointsError('EVENT_CONFLICT')
    return { entry: previous, balance: await balanceIn(tx, wallet.id), replayed: true }
  }
  const balance = await balanceIn(tx, wallet.id) + input.amount
  if (balance < 0) throw new MemberPointsError('INSUFFICIENT_POINTS')
  if (!Number.isSafeInteger(balance)) throw new MemberPointsError('VALIDATION')
  const entry = await tx.pointEntry.create({ data: { walletId: wallet.id, amount: input.amount, source: input.source,
    eventRef: input.eventRef, actorId: input.actorId, reason: input.reason } })
  return { entry, balance, replayed: false }
}

export async function dailyOpen(scope: Scope) {
  return prisma.$transaction(async tx => {
    const wallet = await lockWallet(tx, scope)
    const eventRef = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const previous = await tx.pointEntry.findUnique({ where: { walletId_source_eventRef: { walletId: wallet.id, source: 'DAILY_OPEN', eventRef } } })
    if (previous) return { granted: 0, balance: await balanceIn(tx, wallet.id), alreadyClaimedToday: true }
    const policy = await tx.storePointPolicy.findUnique({ where: { storeId: scope.storeId } })
    const amount = policy?.dailyOpenPoints ?? 0
    // Zero is unconfigured/off, so no fake earnings or ledger entries.
    if (!amount) return { granted: 0, balance: await balanceIn(tx, wallet.id), alreadyClaimedToday: false }
    const result = await recordPointsIn(tx, { ...scope, source: 'DAILY_OPEN', eventRef, amount })
    return { granted: amount, balance: result.balance, alreadyClaimedToday: false }
  })
}

export async function pointLedger(scope: Scope, cursor?: string, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new MemberPointsError('VALIDATION')
  if (cursor && !z.string().uuid().safeParse(cursor).success) throw new MemberPointsError('VALIDATION')
  return prisma.$transaction(async tx => {
    const store = await tx.store.findFirst({ where: { id: scope.storeId, businessId: scope.businessId } })
    const account = await tx.memberAccount.findFirst({ where: { id: scope.accountId, deletedAt: null } })
    if (!store || !account) throw new MemberPointsError('NOT_FOUND')
    const wallet = await tx.pointWallet.findUnique({ where: { accountId_storeId: { accountId: scope.accountId, storeId: scope.storeId } } })
    if (!wallet) {
      if (cursor) throw new MemberPointsError('NOT_FOUND')
      return { businessId: scope.businessId, storeId: scope.storeId, balance: 0, entries: [], nextCursor: null }
    }
    const anchor = cursor ? await tx.pointEntry.findFirst({ where: { id: cursor, walletId: wallet.id } }) : null
    if (cursor && !anchor) throw new MemberPointsError('NOT_FOUND')
    // Compare with the original DB timestamp: JS Date truncates PostgreSQL
    // microseconds and can otherwise skip entries sharing a cursor timestamp.
    const rows = await tx.$queryRaw<{ id: string; amount: number; source: string; eventRef: string; occurredAt: Date }[]>`
      SELECT id,amount,source,event_ref AS "eventRef",occurred_at AS "occurredAt"
      FROM point_entries WHERE wallet_id=${wallet.id}::uuid
        AND (${cursor ?? null}::uuid IS NULL OR (occurred_at,id) < (
          SELECT occurred_at,id FROM point_entries WHERE id=${cursor ?? null}::uuid AND wallet_id=${wallet.id}::uuid))
      ORDER BY occurred_at DESC,id DESC LIMIT ${limit + 1}`
    const entries = rows.slice(0, limit).map(row => ({ entryId: row.id, accountId: scope.accountId,
      businessId: scope.businessId, storeId: scope.storeId, amount: Math.abs(row.amount),
      direction: row.amount > 0 ? 'EARN' as const : 'SPEND' as const, source: row.source,
      eventRef: row.eventRef, occurredAt: row.occurredAt.toISOString() }))
    return { businessId: scope.businessId, storeId: scope.storeId, balance: await balanceIn(tx, wallet.id), entries,
      nextCursor: rows.length > limit ? entries[entries.length - 1].entryId : null }
  }, { isolationLevel: 'RepeatableRead' })
}
