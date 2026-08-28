import { prisma } from '../db/client.js'
import { isUniqueViolation } from '../db/prisma-errors.js'

// Bed plane phase 2 (item 7): treatment qualifications. A qualification is a
// per-business label (e.g. アートメイク認定); staff hold a set of them
// (staff_qualifications, replace-the-set like staff_stores) and a menu may
// require one (menus.required_qualification_id). Informational — readers
// filter bookable staff by it; core does not enforce at booking time (same
// posture as required_room_class).

export class QualificationNameTakenError extends Error {
  constructor(message = 'A qualification with this name already exists.') {
    super(message)
    this.name = 'QualificationNameTakenError'
  }
}

export interface QualificationPublic {
  id: string
  business_id: string
  name: string
  active: boolean
  created_at: string
  updated_at: string
}

function toPublic(r: {
  id: string
  businessId: string
  name: string
  active: boolean
  createdAt: Date
  updatedAt: Date
}): QualificationPublic {
  return {
    id: r.id,
    business_id: r.businessId,
    name: r.name,
    active: r.active,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }
}

export async function listQualifications(
  businessId: string,
  options: { active?: boolean },
): Promise<QualificationPublic[]> {
  const rows = await prisma.qualification.findMany({
    where: { businessId, ...(options.active !== undefined ? { active: options.active } : {}) },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(toPublic)
}

export async function createQualification(
  businessId: string,
  input: { name: string },
): Promise<QualificationPublic> {
  try {
    const row = await prisma.qualification.create({
      data: { businessId, name: input.name },
    })
    return toPublic(row)
  } catch (e) {
    if (isUniqueViolation(e, 'name')) throw new QualificationNameTakenError()
    throw e
  }
}

/** Rename / retire (active:false). No hard delete — menus reference these. */
export async function updateQualification(
  businessId: string,
  id: string,
  input: { name?: string; active?: boolean },
): Promise<QualificationPublic | null> {
  const existing = await prisma.qualification.findFirst({ where: { id, businessId } })
  if (!existing) return null
  try {
    const row = await prisma.qualification.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    })
    return toPublic(row)
  } catch (e) {
    if (isUniqueViolation(e, 'name')) throw new QualificationNameTakenError()
    throw e
  }
}

/** Same identity resolution as staff-stores: accepts the core staff.id OR the
 *  karute profile id (staff.user_id); links always store the card id. */
async function resolveStaffId(businessId: string, idOrUserId: string): Promise<string | null> {
  const staff = await prisma.staff.findFirst({
    where: { businessId, OR: [{ id: idOrUserId }, { userId: idOrUserId }] },
    select: { id: true },
  })
  return staff?.id ?? null
}

/** The qualification ids a staff member holds. */
export async function getStaffQualifications(
  businessId: string,
  staffId: string,
): Promise<string[]> {
  const resolved = await resolveStaffId(businessId, staffId)
  if (!resolved) return []
  const rows = await prisma.staffQualification.findMany({
    where: { businessId, staffId: resolved },
    select: { qualificationId: true },
  })
  return rows.map((r) => r.qualificationId)
}

/** Replace a staff member's full qualification set — one transaction, same
 *  semantics as setStaffStores. */
export async function setStaffQualifications(
  businessId: string,
  staffId: string,
  qualificationIds: string[],
): Promise<{ ok: true }> {
  const resolved = await resolveStaffId(businessId, staffId)
  if (!resolved) throw new Error('Staff not found')

  const wanted = Array.from(new Set(qualificationIds))
  if (wanted.length > 0) {
    const valid = await prisma.qualification.findMany({
      where: { businessId, id: { in: wanted } },
      select: { id: true },
    })
    if (valid.length !== wanted.length) throw new Error('Qualification not found')
  }

  await prisma.$transaction([
    ...wanted.map((qualificationId) =>
      prisma.staffQualification.upsert({
        where: { staffId_qualificationId: { staffId: resolved, qualificationId } },
        create: { staffId: resolved, qualificationId, businessId },
        update: {},
      }),
    ),
    prisma.staffQualification.deleteMany({
      where: {
        businessId,
        staffId: resolved,
        ...(wanted.length > 0 ? { qualificationId: { notIn: wanted } } : {}),
      },
    }),
  ])
  return { ok: true }
}

/** Every staff→qualification link in ONE read, keyed by the card id — the
 *  board's bulk read (absent key = no qualifications). */
export async function getAllStaffQualifications(
  businessId: string,
): Promise<Record<string, string[]>> {
  const rows = await prisma.staffQualification.findMany({
    where: { businessId },
    select: { staffId: true, qualificationId: true },
  })
  const assignments: Record<string, string[]> = {}
  for (const r of rows) (assignments[r.staffId] ??= []).push(r.qualificationId)
  return assignments
}
