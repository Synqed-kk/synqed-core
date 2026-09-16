import { randomUUID } from 'node:crypto'
import { prisma } from '../db/client.js'
import { Prisma, type StoreBookingPolicy } from '@prisma/client'
import { logEventIn, type AuditEventInput } from './audit.service.js'
import { isUniqueViolation } from '../db/prisma-errors.js'
import type { PermissionRole } from './permission-rulebook.js'

/** One open/close window per weekday ("10:00"–"20:00"); null/absent weekday =
 *  定休日. The whole value is null when the store never configured hours —
 *  readers then keep their pre-hours behavior. */
export type WeeklyHours = Partial<
  Record<
    'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
    { open: string; close: string } | null
  >
>

export type SpecialOpenDay = { date: string; open: string; close: string }
export type AutoReleaseBefore = 'linked' | 'never' | `${number}`

export class ClosedDayExistsError extends Error {
  constructor(message = 'This date is already a closed day for the store.') {
    super(message)
    this.name = 'ClosedDayExistsError'
  }
}

export type StorePolicyWriteErrorCode =
  | 'acting_staff_not_in_business'
  | 'acting_staff_role_forbidden'
  | 'store_not_found'

export class StorePolicyWriteError extends Error {
  constructor(public code: StorePolicyWriteErrorCode, public status: 400 | 403 | 404, message: string) {
    super(message)
    this.name = 'StorePolicyWriteError'
  }
}

/** Policy writers accept a core staff card id only; login/profile ids never
 * become the persisted updater or audit actor. Both rows stay locked through
 * the mutation, so a concurrent store move or OWNER demotion cannot race the
 * authorization decision. Unknown/foreign stores stay 404. */
async function lockStorePolicyOwner(
  tx: Prisma.TransactionClient,
  businessId: string,
  storeId: string,
  staffId: string,
): Promise<void> {
  const store = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM stores
    WHERE id = ${storeId}::uuid AND business_id = ${businessId}::uuid
    FOR UPDATE
  `
  if (!store.length) throw new StorePolicyWriteError('store_not_found', 404, 'Store not found')
  const staff = await tx.$queryRaw<{ role: string; is_active: boolean }[]>`
    SELECT role::text, is_active FROM staff
    WHERE id = ${staffId}::uuid AND business_id = ${businessId}::uuid
    FOR SHARE
  `
  if (!staff.length) {
    throw new StorePolicyWriteError('acting_staff_not_in_business', 400, 'Acting staff not found in this business.')
  }
  if (staff[0].role !== 'OWNER' || !staff[0].is_active) {
    throw new StorePolicyWriteError('acting_staff_role_forbidden', 403, 'This action requires an active OWNER staff member.')
  }
}

// Booking-acceptance policy per store (Liam item 3). One row per store;
// absent row = these platform defaults — the numbers reserve shipped with
// hardcoded, so a store with no saved policy behaves exactly as before.
export const POLICY_DEFAULTS = {
  booking_open_days: 30,
  cutoff_minutes: 0,
  cancel_free_until_hours: 24,
  cancel_late_pct: 0,
  no_show_pct: 0,
  // スキマガード Phase 1: default OFF everywhere; 90-minute protected window.
  gap_guard_mode: 'OFF' as 'OFF' | 'STANDARD' | 'STRICT',
  new_client_session_minutes: 90,
  override_roles: ['owner', 'manager', 'practitioner'] as PermissionRole[],
  override_locked_out: [] as string[],
  override_hold_to_confirm: true,
  override_strict_wall: false,
  min_sellable_min: 30,
  gap_fill_min_min: null,
  held_rank_access: 'closed' as 'closed' | 'silver' | 'gold' | 'platinum',
  release_held_roles: ['owner', 'manager'] as PermissionRole[],
  booking_step_min: 30,
  block_step_min: 15,
  gap_fill_discount_pct: null,
  lead_time_min: null,
  reserve_start_grid_min: null,
  standard_session_min: null,
  sell_slot_min: 60,
  auto_release_before: 'linked' as AutoReleaseBefore,
  calendar_tight_max: 2,
  price_lock_during_recalc: null,
  breaks_paid: false,
  special_open_days: [] as SpecialOpenDay[],
} as const

export interface PolicyPublic {
  override_roles: PermissionRole[]
  override_locked_out: string[]
  override_hold_to_confirm: boolean
  override_strict_wall: boolean
  min_sellable_min: number
  gap_fill_min_min: number | null
  held_rank_access: 'closed' | 'silver' | 'gold' | 'platinum'
  release_held_roles: PermissionRole[]
  booking_step_min: number
  block_step_min: number
  gap_fill_discount_pct: number | null
  lead_time_min: number | null
  reserve_start_grid_min: number | null
  standard_session_min: number | null
  sell_slot_min: number
  auto_release_before: AutoReleaseBefore
  calendar_tight_max: number
  price_lock_during_recalc: boolean | null
  breaks_paid: boolean
  special_open_days: SpecialOpenDay[]
  store_id: string
  booking_open_days: number
  cutoff_minutes: number
  cancel_free_until_hours: number
  cancel_late_pct: number
  no_show_pct: number
  gap_guard_mode: 'OFF' | 'STANDARD' | 'STRICT'
  new_client_session_minutes: number
  /** Weekly opening hours; null = never configured (no hours filtering). */
  weekly_hours: WeeklyHours | null
  /** 'custom' = a saved row; 'default' = platform defaults (no row yet). */
  source: 'custom' | 'default'
  updated_by: string | null
  updated_at: string | null
}

function toPublic(storeId: string, r: StoreBookingPolicy | null): PolicyPublic {
  if (!r) {
    return { store_id: storeId, ...POLICY_DEFAULTS, weekly_hours: null, source: 'default', updated_by: null, updated_at: null }
  }
  return {
    store_id: storeId,
    override_roles: r.overrideRoles as PermissionRole[],
    override_locked_out: r.overrideLockedOut,
    override_hold_to_confirm: r.overrideHoldToConfirm,
    override_strict_wall: r.overrideStrictWall,
    min_sellable_min: r.minSellableMin,
    gap_fill_min_min: r.gapFillMinMin,
    held_rank_access: r.heldRankAccess as PolicyPublic['held_rank_access'],
    release_held_roles: r.releaseHeldRoles as PermissionRole[],
    booking_step_min: r.bookingStepMin,
    block_step_min: r.blockStepMin,
    gap_fill_discount_pct: r.gapFillDiscountPct,
    lead_time_min: r.leadTimeMin,
    reserve_start_grid_min: r.reserveStartGridMin,
    standard_session_min: r.standardSessionMin,
    sell_slot_min: r.sellSlotMin,
    auto_release_before: r.autoReleaseBefore as AutoReleaseBefore,
    calendar_tight_max: r.calendarTightMax,
    price_lock_during_recalc: r.priceLockDuringRecalc,
    breaks_paid: r.breaksPaid,
    special_open_days: r.specialOpenDays as SpecialOpenDay[],
    booking_open_days: r.bookingOpenDays,
    cutoff_minutes: r.cutoffMinutes,
    cancel_free_until_hours: r.cancelFreeUntilHours,
    cancel_late_pct: r.cancelLatePct,
    no_show_pct: r.noShowPct,
    gap_guard_mode: r.gapGuardMode,
    new_client_session_minutes: r.newClientSessionMinutes,
    weekly_hours: (r.weeklyHours as WeeklyHours | null) ?? null,
    source: 'custom',
    updated_by: r.updatedBy,
    updated_at: r.updatedAt.toISOString(),
  }
}

/** The BFF read: one store's effective policy (defaults when unsaved). */
export async function getPolicy(businessId: string, storeId: string): Promise<PolicyPublic | null> {
  const store = await prisma.store.findFirst({
    where: { id: storeId, businessId },
    select: { id: true },
  })
  if (!store) return null
  const row = await prisma.storeBookingPolicy.findFirst({ where: { businessId, storeId } })
  return toPublic(storeId, row)
}

/** Dashboard read: effective policy for every store of the business. */
export async function listPolicies(businessId: string): Promise<PolicyPublic[]> {
  const [stores, rows] = await Promise.all([
    prisma.store.findMany({ where: { businessId }, select: { id: true }, orderBy: { createdAt: 'asc' } }),
    prisma.storeBookingPolicy.findMany({ where: { businessId } }),
  ])
  const byStore = new Map(rows.map((r) => [r.storeId, r]))
  return stores.map((s) => toPublic(s.id, byStore.get(s.id) ?? null))
}

export interface SetPolicyInput {
  override_roles?: PermissionRole[]
  override_locked_out?: string[]
  override_hold_to_confirm?: boolean
  override_strict_wall?: boolean
  min_sellable_min?: number
  gap_fill_min_min?: number | null
  held_rank_access?: 'closed' | 'silver' | 'gold' | 'platinum'
  release_held_roles?: PermissionRole[]
  booking_step_min?: number
  block_step_min?: number
  gap_fill_discount_pct?: number | null
  lead_time_min?: number | null
  reserve_start_grid_min?: number | null
  standard_session_min?: number | null
  sell_slot_min?: number
  auto_release_before?: AutoReleaseBefore
  calendar_tight_max?: number
  price_lock_during_recalc?: boolean | null
  breaks_paid?: boolean
  special_open_days?: SpecialOpenDay[]
  booking_open_days?: number
  cutoff_minutes?: number
  cancel_free_until_hours?: number
  cancel_late_pct?: number
  no_show_pct?: number
  gap_guard_mode?: 'OFF' | 'STANDARD' | 'STRICT'
  new_client_session_minutes?: number
  /** undefined = keep; null = clear back to unconfigured; object = set. */
  weekly_hours?: WeeklyHours | null
}

type PolicyChange = { field: keyof PolicyPublic; before: unknown; after: unknown }

/** Audit details have a 2KB cap. Oversized collection changes become indexed
 * entries (plus original lengths), then all entries are packed into bounded
 * records. The request id and part numbers reconstruct one atomic save. */
function auditParts(changes: PolicyChange[]) {
  const entries = changes.flatMap<unknown>(change => {
    if (Buffer.byteLength(JSON.stringify(change), 'utf8') <= 1700 ||
      !Array.isArray(change.before) || !Array.isArray(change.after)) return [change]
    const before: unknown[] = change.before
    const after: unknown[] = change.after
    return [
      { field: change.field, before_length: before.length, after_length: after.length },
      ...Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({
        field: change.field, index, before: before[index] ?? null, after: after[index] ?? null,
      })),
    ]
  })
  const parts: unknown[][] = []
  let part: unknown[] = []
  for (const entry of entries) {
    if (part.length && Buffer.byteLength(JSON.stringify({ changes: [...part, entry] }), 'utf8') > 1800) {
      parts.push(part)
      part = []
    }
    part.push(entry)
  }
  if (part.length) parts.push(part)
  return parts.map((changes, index) => ({ changes, part: index + 1, parts: parts.length }))
}

/** Upsert a store's policy. Partial: omitted fields keep their current value
 *  (or the default on first save). Optional audit commits transactionally. */
export async function setPolicy(
  businessId: string,
  storeId: string,
  actingStaffId: string,
  input: SetPolicyInput,
  audit?: AuditEventInput,
): Promise<PolicyPublic> {
  const row = await prisma.$transaction(async (tx) => {
    // The store lock also serializes first saves, when no policy row exists.
    await lockStorePolicyOwner(tx, businessId, storeId, actingStaffId)
    const before = toPublic(storeId, await tx.storeBookingPolicy.findFirst({ where: { storeId, businessId } }))
    const settingsData = {
      overrideRoles: input.override_roles,
      overrideLockedOut: input.override_locked_out,
      overrideHoldToConfirm: input.override_hold_to_confirm,
      overrideStrictWall: input.override_strict_wall,
      minSellableMin: input.min_sellable_min,
      gapFillMinMin: input.gap_fill_min_min,
      heldRankAccess: input.held_rank_access,
      releaseHeldRoles: input.release_held_roles,
      bookingStepMin: input.booking_step_min,
      blockStepMin: input.block_step_min,
      gapFillDiscountPct: input.gap_fill_discount_pct,
      leadTimeMin: input.lead_time_min,
      reserveStartGridMin: input.reserve_start_grid_min,
      standardSessionMin: input.standard_session_min,
      sellSlotMin: input.sell_slot_min,
      autoReleaseBefore: input.auto_release_before,
      calendarTightMax: input.calendar_tight_max,
      priceLockDuringRecalc: input.price_lock_during_recalc,
      breaksPaid: input.breaks_paid,
      specialOpenDays: input.special_open_days as Prisma.InputJsonValue | undefined,
    }
    const updated = await tx.storeBookingPolicy.upsert({
      where: { storeId },
      create: {
        businessId,
        storeId,
        ...settingsData,
        bookingOpenDays: input.booking_open_days ?? POLICY_DEFAULTS.booking_open_days,
        cutoffMinutes: input.cutoff_minutes ?? POLICY_DEFAULTS.cutoff_minutes,
        cancelFreeUntilHours: input.cancel_free_until_hours ?? POLICY_DEFAULTS.cancel_free_until_hours,
        cancelLatePct: input.cancel_late_pct ?? POLICY_DEFAULTS.cancel_late_pct,
        noShowPct: input.no_show_pct ?? POLICY_DEFAULTS.no_show_pct,
        gapGuardMode: input.gap_guard_mode ?? POLICY_DEFAULTS.gap_guard_mode,
        newClientSessionMinutes: input.new_client_session_minutes ?? POLICY_DEFAULTS.new_client_session_minutes,
        ...(input.weekly_hours != null ? { weeklyHours: input.weekly_hours as Prisma.InputJsonValue } : {}),
        updatedBy: actingStaffId,
      },
      update: {
        ...settingsData,
        ...(input.booking_open_days !== undefined ? { bookingOpenDays: input.booking_open_days } : {}),
        ...(input.cutoff_minutes !== undefined ? { cutoffMinutes: input.cutoff_minutes } : {}),
        ...(input.cancel_free_until_hours !== undefined
          ? { cancelFreeUntilHours: input.cancel_free_until_hours }
          : {}),
        ...(input.cancel_late_pct !== undefined ? { cancelLatePct: input.cancel_late_pct } : {}),
        ...(input.no_show_pct !== undefined ? { noShowPct: input.no_show_pct } : {}),
        ...(input.gap_guard_mode !== undefined ? { gapGuardMode: input.gap_guard_mode } : {}),
        ...(input.new_client_session_minutes !== undefined
          ? { newClientSessionMinutes: input.new_client_session_minutes }
          : {}),
        // Json-null nuance: null must clear the COLUMN (DbNull), not store a
        // JSON null literal.
        ...(input.weekly_hours !== undefined
          ? { weeklyHours: input.weekly_hours === null ? Prisma.DbNull : (input.weekly_hours as Prisma.InputJsonValue) }
          : {}),
        updatedBy: actingStaffId,
      },
    })
    const after = toPublic(storeId, updated)
    const changes = Object.keys(input).flatMap(key => {
      const field = key as keyof PolicyPublic
      return JSON.stringify(before[field]) === JSON.stringify(after[field]) ? [] : [{ field, before: before[field], after: after[field] }]
    })
    const requestId = audit?.request_id ?? randomUUID()
    for (const detail of auditParts(changes)) {
      await logEventIn(tx, businessId, { ...audit, actor_id: actingStaffId, actor_type: 'staff',
        actor_staff_ref: undefined, actor_label: undefined, actor_role: undefined,
        store_id: storeId, category: 'settings', action: 'store_policy.edit',
        target_type: 'store_booking_policy', target_id: storeId, request_id: requestId, detail })
    }
    return updated
  })
  return toPublic(storeId, row)
}

// =============================================================================
// Ad-hoc closed days (臨時休業) — the exceptions the board and Reserve's
// calendar subtract on top of weekly_hours.
// =============================================================================

export interface ClosedDayPublic {
  id: string
  store_id: string
  /** YYYY-MM-DD */
  date: string
  reason: string | null
  created_by: string | null
  created_at: string
}

function closedDayToPublic(r: {
  id: string
  storeId: string
  date: Date
  reason: string | null
  createdBy: string | null
  createdAt: Date
}): ClosedDayPublic {
  return {
    id: r.id,
    store_id: r.storeId,
    date: r.date.toISOString().slice(0, 10),
    reason: r.reason,
    created_by: r.createdBy,
    created_at: r.createdAt.toISOString(),
  }
}

/** Closed days for one store, optionally date-bounded. Null = store unknown. */
export async function listClosedDays(
  businessId: string,
  storeId: string,
  range: { from?: string; to?: string },
): Promise<ClosedDayPublic[] | null> {
  const store = await prisma.store.findFirst({ where: { id: storeId, businessId }, select: { id: true } })
  if (!store) return null
  const rows = await prisma.storeClosedDay.findMany({
    where: {
      businessId,
      storeId,
      ...(range.from || range.to
        ? {
            date: {
              ...(range.from ? { gte: new Date(range.from) } : {}),
              ...(range.to ? { lt: new Date(range.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { date: 'asc' },
  })
  return rows.map(closedDayToPublic)
}

/** Add one closed date. Null = store unknown; duplicate date = 409. */
export async function addClosedDay(
  businessId: string,
  storeId: string,
  actingStaffId: string,
  input: { date: string; reason?: string | null },
  audit?: AuditEventInput,
): Promise<ClosedDayPublic> {
  try {
    const row = await prisma.$transaction(async (tx) => {
      await lockStorePolicyOwner(tx, businessId, storeId, actingStaffId)
      const created = await tx.storeClosedDay.create({
        data: {
          businessId,
          storeId,
          date: new Date(input.date),
          reason: input.reason ?? null,
          createdBy: actingStaffId,
        },
      })
      if (audit) await logEventIn(tx, businessId, { ...audit, target_id: audit.target_id ?? storeId })
      return created
    })
    return closedDayToPublic(row)
  } catch (e) {
    // UNIQUE(store_id, date) — the constraint name carries both columns.
    if (isUniqueViolation(e, 'date')) throw new ClosedDayExistsError()
    throw e
  }
}

/** Remove a closed date. False = no such row for this business/store. */
export async function removeClosedDay(
  businessId: string,
  storeId: string,
  actingStaffId: string,
  id: string,
  audit?: AuditEventInput,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockStorePolicyOwner(tx, businessId, storeId, actingStaffId)
    const removed = await tx.storeClosedDay.deleteMany({ where: { id, businessId, storeId } })
    if (!removed.count) return false
    if (audit) await logEventIn(tx, businessId, { ...audit, target_id: audit.target_id ?? storeId })
    return true
  })
}
