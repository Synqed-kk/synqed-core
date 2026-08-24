// The ONE permission rulebook (Liam msg-7 item 1: "two apps with separate
// rulebooks eventually disagree — a security hole, not a sync bug"). Ported
// line-faithfully from karute src/lib/auth/permissions.ts and extended with
// the three 8/18 presets. PURE — no imports, no DB. Both apps read THIS via
// GET /permissions/rulebook; karute's local copy becomes a fallback shim.
//
// 8/18 rulings baked in (Liam):
//   主任 (senior)          = OWN store only  → stores.viewAll REMOVED from the
//                            preset karute shipped (this is the one deliberate
//                            divergence from the ported file — his enforcement
//                            decision supersedes it).
//   経理・顧問 (accountant) = ALL-store money-read, money ONLY.
//   エリアマネージャー      = store-manager rights over an ASSIGNED store list.
//   Fixed preset roles only in v1 — named custom roles stay future work; the
//   single blank 'custom' slot carries over as-is.

export const CAPABILITIES = [
  'billing.manage',
  'business.manage',
  'staff.invite',
  'staff.manage',
  'settings.manage',
  'menus.manage',
  'audit.view',
  'sync.view',
  'data.export',
  'records.delete',
  'records.write',
  'recordings.viewAll', // OWNER ONLY — enforced at resolve, never presetable
  'analytics.viewAll',
  'stores.viewAll',
  'alerts.manage',
  'customers.view',
  'bookings.manage',
  // 8/18: read-only money surfaces (sales/packs/register views). The
  // accountant preset is exactly this and nothing else.
  'money.view',
] as const
export type Capability = (typeof CAPABILITIES)[number]

export const PERMISSION_ROLES = [
  'owner',
  'manager',
  'senior',
  'practitioner',
  'frontdesk',
  'custom',
  // 8/18 additions — the Business screens' 8-role vocabulary:
  'area_manager',
  'trainee',
  'accountant',
] as const
export type PermissionRole = (typeof PERMISSION_ROLES)[number]

const ALL: Capability[] = [...CAPABILITIES]

export const ROLE_PRESETS: Record<PermissionRole, Capability[]> = {
  owner: ALL,
  manager: ALL.filter(
    (c) =>
      c !== 'billing.manage' &&
      c !== 'business.manage' &&
      c !== 'recordings.viewAll' &&
      c !== 'audit.view' &&
      c !== 'sync.view',
  ),
  // 主任: karute's senior preset MINUS stores.viewAll (8/18: own store only).
  senior: ['records.write', 'records.delete', 'data.export', 'analytics.viewAll', 'customers.view', 'bookings.manage', 'menus.manage', 'money.view'],
  practitioner: ['records.write', 'customers.view', 'bookings.manage'],
  frontdesk: ['customers.view', 'bookings.manage'],
  custom: [],
  // Store-manager rights over the assigned list: the manager preset, scope
  // applied via assigned_store_ids in the answer sheet (never stores.viewAll).
  area_manager: ALL.filter(
    (c) =>
      c !== 'billing.manage' &&
      c !== 'business.manage' &&
      c !== 'recordings.viewAll' &&
      c !== 'audit.view' &&
      c !== 'sync.view' &&
      c !== 'stores.viewAll',
  ),
  // Learning the floor: view-only, nothing written, nothing destructive.
  trainee: ['customers.view'],
  // 経理・顧問: money only, all stores (store scope handled in the sheet).
  accountant: ['money.view'],
}

/** Coarse mirror to the 4-value StaffRole label — kept as the outer label per
 *  spec ("the four-value label kept as the coarse outer label"). */
export const ROLE_TO_COARSE: Record<PermissionRole, 'OWNER' | 'ADMIN' | 'STYLIST' | 'ASSISTANT'> = {
  owner: 'OWNER',
  manager: 'ADMIN',
  senior: 'STYLIST',
  practitioner: 'STYLIST',
  frontdesk: 'ASSISTANT',
  custom: 'ASSISTANT',
  area_manager: 'ADMIN',
  trainee: 'ASSISTANT',
  accountant: 'ASSISTANT',
}

/** Absent assignment row → derive the preset from the coarse label, exactly
 *  like karute's synqedRoleToPreset (compat: unassigned staff behave as today). */
export function coarseRoleToPreset(role: string | null | undefined): PermissionRole {
  switch ((role ?? '').toUpperCase()) {
    case 'OWNER':
      return 'owner'
    case 'ADMIN':
      return 'manager'
    case 'ASSISTANT':
      return 'frontdesk'
    case 'STYLIST':
    default:
      return 'practitioner'
  }
}

/** Bump when the MEANING of the rulebook changes (preset edits, new
 *  capabilities). Part of the answer-sheet version so screens re-ask. */
export const RULEBOOK_VERSION = 1

/** Effective capability set — the single chokepoint, identical semantics to
 *  karute's effectiveCapabilities: an explicit per-staff override REPLACES the
 *  preset; unknown stored keys drop (forward-compatible); recordings.viewAll
 *  is stripped for every non-owner at resolve time (recorder-private ruling —
 *  self-heals stale overrides with no data migration). */
export function effectiveCapabilities(
  role: PermissionRole,
  override: readonly string[] | null | undefined,
): Capability[] {
  const valid = new Set<string>(CAPABILITIES)
  const source = override ?? ROLE_PRESETS[role] ?? []
  const caps = new Set(source.filter((c): c is Capability => valid.has(c)))
  if (role !== 'owner') caps.delete('recordings.viewAll')
  return CAPABILITIES.filter((c) => caps.has(c))
}
