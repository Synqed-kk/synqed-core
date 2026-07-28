import { prisma } from '../db/client.js'
import { Prisma } from '@prisma/client'

/** A claim whose owner never completed it (crash between create and complete)
 *  is considered abandoned after this window and can be taken over. */
const STALE_CLAIM_MS = 60_000

export type ClaimResult =
  | { kind: 'claimed'; claimId: string }
  | { kind: 'replay'; appointmentId: string }
  | { kind: 'in_flight' }

/** Claim an Idempotency-Key for this business, or resolve what the previous
 *  holder did with it. Exactly one concurrent caller wins the claim; the rest
 *  see replay (done) or in_flight (not done yet — retry shortly). */
export async function claimKey(businessId: string, key: string): Promise<ClaimResult> {
  try {
    const row = await prisma.idempotencyKey.create({
      data: { businessId, key },
      select: { id: true },
    })
    return { kind: 'claimed', claimId: row.id }
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e
  }

  const existing = await prisma.idempotencyKey.findUnique({
    where: { businessId_key: { businessId, key } },
    select: { id: true, appointmentId: true, createdAt: true },
  })
  // Deleted between our insert-conflict and this read (loser's release):
  // treat as in-flight and let the caller retry the whole claim.
  if (!existing) return { kind: 'in_flight' }
  if (existing.appointmentId) return { kind: 'replay', appointmentId: existing.appointmentId }

  // Stale claim takeover — guarded UPDATE so only one taker wins.
  if (Date.now() - existing.createdAt.getTime() > STALE_CLAIM_MS) {
    const taken = await prisma.idempotencyKey.updateMany({
      where: { id: existing.id, appointmentId: null, createdAt: existing.createdAt },
      data: { createdAt: new Date() },
    })
    if (taken.count === 1) return { kind: 'claimed', claimId: existing.id }
  }
  return { kind: 'in_flight' }
}

/** Record the created appointment on the claim — from here on the key replays. */
export async function completeKey(claimId: string, appointmentId: string): Promise<void> {
  await prisma.idempotencyKey.update({ where: { id: claimId }, data: { appointmentId } })
}

/** The create failed — free the key so a retry can attempt it fresh. */
export async function releaseKey(claimId: string): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { id: claimId, appointmentId: null } })
}
