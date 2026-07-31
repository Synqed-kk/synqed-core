import { prisma } from '../db/client.js'
import type { BusinessGrantType } from '@prisma/client'

// Org-level capabilities, separate from per-store staff roles (approved
// permission design). HQ_ADMIN = "manage brand settings across stores" — the
// gate in front of pricing rules / acceptance policy / messaging templates.

export class NotHqAdminError extends Error {
  constructor(message = 'This action requires the HQ_ADMIN grant.') {
    super(message)
    this.name = 'NotHqAdminError'
  }
}

/** Accepts either identity form (staff card id or login uuid) — same contract
 *  as staff-store and audit lookups; grants always store under the card. */
async function resolveStaffId(businessId: string, idOrUserId: string): Promise<string | null> {
  const staff = await prisma.staff.findFirst({
    where: { businessId, OR: [{ id: idOrUserId }, { userId: idOrUserId }] },
    select: { id: true },
  })
  return staff?.id ?? null
}

export interface GrantPublic {
  id: string
  staff_id: string
  grant: BusinessGrantType
  granted_by: string | null
  created_at: string
}

export async function listGrants(businessId: string): Promise<GrantPublic[]> {
  const rows = await prisma.businessGrant.findMany({
    where: { businessId, revokedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    staff_id: r.staffId,
    grant: r.grant,
    granted_by: r.grantedBy,
    created_at: r.createdAt.toISOString(),
  }))
}

export async function hasGrant(
  businessId: string,
  staffIdOrUserId: string,
  grant: BusinessGrantType,
): Promise<boolean> {
  const staffId = await resolveStaffId(businessId, staffIdOrUserId)
  if (!staffId) return false
  const row = await prisma.businessGrant.findFirst({
    where: { businessId, staffId, grant, revokedAt: null },
    select: { id: true },
  })
  return row !== null
}

/** Guard for org-wide settings writes. OWNERs pass by role (the business owner
 *  must never be locked out of their own org settings — and someone has to be
 *  able to mint the first grant); everyone else needs a live HQ_ADMIN grant. */
export async function requireHqAdmin(businessId: string, staffIdOrUserId: string): Promise<void> {
  const staffId = await resolveStaffId(businessId, staffIdOrUserId)
  if (!staffId) throw new NotHqAdminError('Acting staff not found in this business.')
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, businessId },
    select: { role: true, isActive: true },
  })
  if (!staff || !staff.isActive) throw new NotHqAdminError('Acting staff not found or inactive.')
  if (staff.role === 'OWNER') return
  const grant = await prisma.businessGrant.findFirst({
    where: { businessId, staffId, grant: 'HQ_ADMIN', revokedAt: null },
    select: { id: true },
  })
  if (!grant) throw new NotHqAdminError()
}

/** Grant an org capability. Only an OWNER or an existing HQ_ADMIN may grant. */
export async function addGrant(
  businessId: string,
  input: { staff_id: string; grant: BusinessGrantType; acting_staff_id: string },
): Promise<GrantPublic> {
  await requireHqAdmin(businessId, input.acting_staff_id)
  const staffId = await resolveStaffId(businessId, input.staff_id)
  if (!staffId) throw new Error('Staff not found')
  const actingId = await resolveStaffId(businessId, input.acting_staff_id)

  // Idempotent on the live grant: re-granting an existing capability returns
  // the current row instead of erroring (the partial unique index backstops
  // the race — two concurrent grants collapse to one).
  const existing = await prisma.businessGrant.findFirst({
    where: { businessId, staffId, grant: input.grant, revokedAt: null },
  })
  const row =
    existing ??
    (await prisma.businessGrant.create({
      data: { businessId, staffId, grant: input.grant, grantedBy: actingId },
    }))
  return {
    id: row.id,
    staff_id: row.staffId,
    grant: row.grant,
    granted_by: row.grantedBy,
    created_at: row.createdAt.toISOString(),
  }
}

/** Soft-revoke — history stays reconstructable. */
export async function revokeGrant(
  businessId: string,
  grantId: string,
  actingStaffIdOrUserId: string,
): Promise<{ ok: boolean }> {
  await requireHqAdmin(businessId, actingStaffIdOrUserId)
  const actingId = await resolveStaffId(businessId, actingStaffIdOrUserId)
  const res = await prisma.businessGrant.updateMany({
    where: { id: grantId, businessId, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: actingId },
  })
  return { ok: res.count > 0 }
}
