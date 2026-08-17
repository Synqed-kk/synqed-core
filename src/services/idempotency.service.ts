import { prisma } from '../db/client.js'
import { Prisma } from '@prisma/client'

/** A claim whose owner never completed it (crash between create and complete)
 *  is considered abandoned after this window and can be taken over. */
const STALE_CLAIM_MS = 60_000

export type ClaimResult =
  | { kind: 'claimed'; claimId: string }
  | { kind: 'replay'; targetId: string }
  | { kind: 'in_flight' }

/** Endpoint family owning the key — the same client key never collides
 *  across scopes. */
export type IdempotencyScope = 'appointment' | 'photo' | 'pack'

/** Claim an Idempotency-Key for this business+scope, or resolve what the
 *  previous holder did with it. Exactly one concurrent caller wins the claim;
 *  the rest see replay (done) or in_flight (not done yet — retry shortly). */
export async function claimKey(
  businessId: string,
  key: string,
  scope: IdempotencyScope = 'appointment',
): Promise<ClaimResult> {
  try {
    const row = await prisma.idempotencyKey.create({
      data: { businessId, scope, key },
      select: { id: true },
    })
    return { kind: 'claimed', claimId: row.id }
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e
  }

  const existing = await prisma.idempotencyKey.findUnique({
    where: { businessId_scope_key: { businessId, scope, key } },
    select: { id: true, targetId: true, createdAt: true },
  })
  // Deleted between our insert-conflict and this read (loser's release):
  // treat as in-flight and let the caller retry the whole claim.
  if (!existing) return { kind: 'in_flight' }
  if (existing.targetId) return { kind: 'replay', targetId: existing.targetId }

  // Stale claim takeover — guarded UPDATE so only one taker wins.
  if (Date.now() - existing.createdAt.getTime() > STALE_CLAIM_MS) {
    const taken = await prisma.idempotencyKey.updateMany({
      where: { id: existing.id, targetId: null, createdAt: existing.createdAt },
      data: { createdAt: new Date() },
    })
    if (taken.count === 1) return { kind: 'claimed', claimId: existing.id }
  }
  return { kind: 'in_flight' }
}

/** Record the created row on the claim — from here on the key replays. */
export async function completeKey(claimId: string, targetId: string): Promise<void> {
  await prisma.idempotencyKey.update({ where: { id: claimId }, data: { targetId } })
}

/** The create failed — free the key so a retry can attempt it fresh. */
export async function releaseKey(claimId: string): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { id: claimId, targetId: null } })
}
