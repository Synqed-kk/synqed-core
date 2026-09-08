import { Prisma, type CoachingConsent } from '@prisma/client'
import { prisma } from '../db/client.js'

// Preserve the version shown by Karute's existing consent dialog until the
// business publishes its own version. Integers in older settings normalize
// to strings; the browser always submits the version Core returned.
const DEFAULT_POLICY_VERSION = 'v1.0-2026-05'

export class CoachingConsentError extends Error {
  constructor(public status: 403 | 404 | 409, message: string) { super(message) }
}

export async function coachingPolicyVersion(tx: Prisma.TransactionClient, businessId: string) {
  const row = await tx.orgSettings.findUnique({ where: { businessId } })
  const settings = row?.settings
  const version = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings.coaching_policy_version : undefined
  return (typeof version === 'string' && version.trim()) ||
    (typeof version === 'number' && Number.isSafeInteger(version) && version > 0
      ? String(version) : DEFAULT_POLICY_VERSION)
}

function publicConsent(row: CoachingConsent) {
  return { id: row.id, status: row.status as 'granted' | 'declined',
    policy_version: row.policyVersion, decided_at: row.createdAt.toISOString() }
}

export async function ownConsent(businessId: string, staffId: string) {
  return prisma.$transaction(async tx => {
    const policyVersion = await coachingPolicyVersion(tx, businessId)
    const row = await tx.coachingConsent.findFirst({ where: { businessId, staffId }, orderBy: { sequence: 'desc' } })
    return {
      current_policy_version: policyVersion,
      status: row?.policyVersion === policyVersion ? row.status as 'granted' | 'declined' : 'unset' as const,
      decision: row ? publicConsent(row) : null,
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export async function appendConsent(businessId: string, staffId: string, userId: string,
  input: { status: 'granted' | 'declined'; policy_version: string }) {
  return prisma.$transaction(async tx => {
    // The same staff-row lock is the serialization point for future generation
    // persistence. Never keep it held during a provider request.
    const staff = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM staff WHERE id = ${staffId}::uuid AND business_id = ${businessId}::uuid
        AND user_id = ${userId}::uuid AND is_active = true FOR UPDATE`
    if (!staff.length) throw new CoachingConsentError(403, 'Active staff login required')
    const policyVersion = await coachingPolicyVersion(tx, businessId)
    // Withdrawal must work even from a stale dialog. Only granting requires
    // agreement to the current version; declines are stamped with that version.
    if (input.status === 'granted' && input.policy_version !== policyVersion)
      throw new CoachingConsentError(409, 'Coaching policy changed; review the current policy')
    const row = await tx.coachingConsent.create({ data: {
      businessId, staffId, createdBy: staffId, status: input.status, policyVersion,
    } })
    return publicConsent(row)
  })
}

export async function ownConsentHistory(businessId: string, staffId: string, cursor?: string) {
  const anchor = cursor ? await prisma.coachingConsent.findFirst({ where: { id: cursor, businessId, staffId } }) : null
  if (cursor && !anchor) throw new CoachingConsentError(404, 'Decision not found')
  const rows = await prisma.coachingConsent.findMany({
    where: { businessId, staffId, ...(anchor ? { sequence: { lt: anchor.sequence } } : {}) },
    orderBy: { sequence: 'desc' }, take: 51,
  })
  const page = rows.slice(0, 50)
  return { decisions: page.map(publicConsent),
    next_cursor: rows.length > 50 ? page[page.length - 1].id : null }
}

/** Store-only aggregate. No per-staff status, timestamps, or history escapes. */
export async function consentAdoption(businessId: string, storeId: string) {
  return prisma.$transaction(async tx => {
    const store = await tx.store.findFirst({ where: { id: storeId, businessId } })
    if (!store) throw new CoachingConsentError(404, 'Store not found')
    const version = await coachingPolicyVersion(tx, businessId)
    const [counts] = await tx.$queryRaw<{ granted: bigint; total: bigint }[]>`
      SELECT count(*) FILTER (WHERE latest.status = 'granted' AND latest.policy_version = ${version}) AS granted,
             count(*) AS total
      FROM staff s
      LEFT JOIN LATERAL (
        SELECT status, policy_version FROM coaching_consent c
        WHERE c.business_id = s.business_id AND c.staff_id = s.id ORDER BY sequence DESC LIMIT 1
      ) latest ON true
      WHERE s.business_id = ${businessId}::uuid AND s.is_active = true
        AND (NOT EXISTS (SELECT 1 FROM staff_stores ss WHERE ss.business_id = s.business_id AND ss.staff_id = s.id)
          OR EXISTS (SELECT 1 FROM staff_stores ss WHERE ss.business_id = s.business_id AND ss.staff_id = s.id
                     AND ss.store_id = ${storeId}::uuid))`
    return { granted: Number(counts.granted), total: Number(counts.total) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
