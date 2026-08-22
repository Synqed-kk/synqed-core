import { prisma } from '../db/client.js'
import { logEventIn, type AuditEventInput } from './audit.service.js'
import {
  CAPABILITIES,
  PERMISSION_ROLES,
  ROLE_PRESETS,
  ROLE_TO_COARSE,
  RULEBOOK_VERSION,
  coarseRoleToPreset,
  effectiveCapabilities,
  type Capability,
  type PermissionRole,
} from './permission-rulebook.js'

// The ONE answer to "what may this person see and do right now" (msg-7 item
// 2): rights + visible stores + a version number, computed server-side.
// Screens never receive-then-hide; a version change tells them to re-ask.

export class InvalidPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPermissionError'
  }
}

async function resolveStaff(businessId: string, idOrUserId: string) {
  return prisma.staff.findFirst({
    where: { businessId, OR: [{ id: idOrUserId }, { userId: idOrUserId }] },
    select: { id: true, role: true, isActive: true },
  })
}

async function businessVersion(businessId: string): Promise<number> {
  const row = await prisma.permissionVersion.findUnique({ where: { businessId } })
  return row?.version ?? 1
}

/** The combined version screens key their caches on: bumps when EITHER the
 *  business's assignments change or the code rulebook's meaning changes. */
function sheetVersion(assignmentVersion: number): string {
  return `${RULEBOOK_VERSION}.${assignmentVersion}`
}

export interface AnswerSheet {
  staff_id: string
  role: PermissionRole
  coarse_role: 'OWNER' | 'ADMIN' | 'STYLIST' | 'ASSISTANT'
  capabilities: Capability[]
  /** null = every store; an array = exactly these stores. */
  visible_store_ids: string[] | null
  /** Money-read scope for the money-only roles: 'all' | null (= follows
   *  visible_store_ids). 経理・顧問 sees money business-wide by ruling. */
  money_scope: 'all' | null
  version: string
}

/** Compute the sheet. Absent assignment row falls back to the coarse label —
 *  unassigned staff behave exactly as before this system existed. */
export async function answerSheet(
  businessId: string,
  staffIdOrUserId: string,
): Promise<AnswerSheet | null> {
  const staff = await resolveStaff(businessId, staffIdOrUserId)
  if (!staff || !staff.isActive) return null

  const assignment = await prisma.staffPermission.findUnique({ where: { staffId: staff.id } })
  const role: PermissionRole =
    assignment && (PERMISSION_ROLES as readonly string[]).includes(assignment.role)
      ? (assignment.role as PermissionRole)
      : coarseRoleToPreset(staff.role)
  const overrides = assignment?.hasOverrides ? assignment.overrides : null
  const capabilities = effectiveCapabilities(role, overrides)

  // Visible stores, per the 8/18 rulings:
  //  - stores.viewAll capability (owner/manager presets) → all stores
  //  - area_manager → exactly the assigned list (empty list = sees nothing,
  //    deliberately loud — an unconfigured area manager is a config error)
  //  - everyone else → their staff_stores assignment (no rows = every store,
  //    the existing house semantic)
  let visibleStoreIds: string[] | null
  if (capabilities.includes('stores.viewAll')) {
    visibleStoreIds = null
  } else if (role === 'area_manager') {
    visibleStoreIds = assignment?.assignedStoreIds ?? []
  } else {
    const rows = await prisma.staffStore.findMany({
      where: { businessId, staffId: staff.id },
      select: { storeId: true },
    })
    visibleStoreIds = rows.length === 0 ? null : rows.map((r) => r.storeId)
  }

  // 経理・顧問: money business-wide regardless of store visibility (money ONLY —
  // their capability list carries nothing else).
  const moneyScope = role === 'accountant' ? ('all' as const) : null

  return {
    staff_id: staff.id,
    role,
    coarse_role: ROLE_TO_COARSE[role],
    capabilities,
    visible_store_ids: visibleStoreIds,
    money_scope: moneyScope,
    version: sheetVersion(await businessVersion(businessId)),
  }
}

export interface AssignmentPublic {
  staff_id: string
  role: PermissionRole
  overrides: string[] | null
  assigned_store_ids: string[]
  updated_by: string | null
  updated_at: string | null
  /** true = explicit row; false = derived from the coarse label. */
  assigned: boolean
}

/** Every staff member's assignment (explicit or derived) — the roster admin read. */
export async function listAssignments(businessId: string): Promise<{
  assignments: AssignmentPublic[]
  version: string
}> {
  const [staffRows, assignments] = await Promise.all([
    prisma.staff.findMany({
      where: { businessId, isActive: true },
      select: { id: true, role: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.staffPermission.findMany({ where: { businessId } }),
  ])
  const byStaff = new Map(assignments.map((a) => [a.staffId, a]))
  return {
    assignments: staffRows.map((s) => {
      const a = byStaff.get(s.id)
      if (!a || !(PERMISSION_ROLES as readonly string[]).includes(a.role)) {
        return {
          staff_id: s.id,
          role: coarseRoleToPreset(s.role),
          overrides: null,
          assigned_store_ids: [],
          updated_by: null,
          updated_at: null,
          assigned: false,
        }
      }
      return {
        staff_id: s.id,
        role: a.role as PermissionRole,
        overrides: a.hasOverrides ? a.overrides : null,
        assigned_store_ids: a.assignedStoreIds,
        updated_by: a.updatedBy,
        updated_at: a.updatedAt.toISOString(),
        assigned: true,
      }
    }),
    version: sheetVersion(await businessVersion(businessId)),
  }
}

export interface SetAssignmentInput {
  role: PermissionRole
  /** null/omitted = follow preset; an array (possibly empty) = explicit
   *  replacement, karute's exact override model. */
  overrides?: string[] | null
  assigned_store_ids?: string[]
  updated_by?: string | null
}

/** Write an assignment + bump the business version, one transaction. Coarse
 *  label on the staff row is kept in sync (the outer label). */
export async function setAssignment(
  businessId: string,
  staffIdOrUserId: string,
  input: SetAssignmentInput,
  audit?: AuditEventInput,
): Promise<AssignmentPublic> {
  const staff = await resolveStaff(businessId, staffIdOrUserId)
  if (!staff) throw new InvalidPermissionError('Staff not found in this business.')
  if (!(PERMISSION_ROLES as readonly string[]).includes(input.role)) {
    throw new InvalidPermissionError('Unknown role.')
  }
  if (input.role === 'area_manager' && (!input.assigned_store_ids || input.assigned_store_ids.length === 0)) {
    throw new InvalidPermissionError('area_manager requires a non-empty assigned store list.')
  }
  if (input.assigned_store_ids && input.assigned_store_ids.length > 0) {
    const stores = await prisma.store.findMany({
      where: { businessId, id: { in: input.assigned_store_ids } },
      select: { id: true },
    })
    if (stores.length !== new Set(input.assigned_store_ids).size) {
      throw new InvalidPermissionError('Store not found in this business.')
    }
  }
  const overrides = input.overrides ?? null
  if (overrides) {
    const valid = new Set<string>(CAPABILITIES)
    const bad = overrides.filter((c) => !valid.has(c))
    if (bad.length > 0) throw new InvalidPermissionError(`Unknown capability: ${bad[0]}`)
  }

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.staffPermission.upsert({
      where: { staffId: staff.id },
      create: {
        businessId,
        staffId: staff.id,
        role: input.role,
        overrides: overrides ?? [],
        hasOverrides: overrides !== null,
        assignedStoreIds: input.assigned_store_ids ?? [],
        updatedBy: input.updated_by ?? null,
      },
      update: {
        role: input.role,
        overrides: overrides ?? [],
        hasOverrides: overrides !== null,
        assignedStoreIds: input.assigned_store_ids ?? [],
        updatedBy: input.updated_by ?? null,
      },
    })
    // Coarse outer label stays in sync on the staff row.
    await tx.staff.update({
      where: { id: staff.id },
      data: { role: ROLE_TO_COARSE[input.role] },
    })
    await tx.permissionVersion.upsert({
      where: { businessId },
      create: { businessId, version: 2 },
      update: { version: { increment: 1 } },
    })
    if (audit) {
      await logEventIn(tx, businessId, { ...audit, target_id: audit.target_id ?? staff.id })
    }
    return saved
  })
  return {
    staff_id: row.staffId,
    role: row.role as PermissionRole,
    overrides: row.hasOverrides ? row.overrides : null,
    assigned_store_ids: row.assignedStoreIds,
    updated_by: row.updatedBy,
    updated_at: row.updatedAt.toISOString(),
    assigned: true,
  }
}

/** The rulebook itself — both apps render toggles from this one source. */
export function rulebook() {
  return {
    rulebook_version: RULEBOOK_VERSION,
    capabilities: CAPABILITIES,
    roles: PERMISSION_ROLES,
    presets: ROLE_PRESETS,
    coarse_labels: ROLE_TO_COARSE,
  }
}
