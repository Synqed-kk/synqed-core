import { prisma } from '../db/client.js'
import { Prisma } from '@prisma/client'
import { logEventIn, type AuditEventInput } from './audit.service.js'
import { isUniqueViolation } from '../db/prisma-errors.js'

/** One open/close window per weekday ("10:00"–"20:00"); null/absent weekday =
 *  定休日. The whole value is null when the store never configured hours —
 *  readers then keep their pre-hours behavior. */
export type WeeklyHours = Partial<
  Record<
    'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
    { open: string; close: string } | null
  >
>

export class ClosedDayExistsError extends Error {
  constructor(message = 'This date is already a closed day for the store.') {
    super(message)
    this.name = 'ClosedDayExistsError'
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
} as const

export interface PolicyPublic {
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

function toPublic(storeId: string, r: {
  bookingOpenDays: number
  cutoffMinutes: number
  cancelFreeUntilHours: number
  cancelLatePct: number
  noShowPct: number
  gapGuardMode: 'OFF' | 'STANDARD' | 'STRICT'
  newClientSessionMinutes: number
  weeklyHours: unknown
  updatedBy: string | null
  updatedAt: Date
} | null): PolicyPublic {
  if (!r) {
    return { store_id: storeId, ...POLICY_DEFAULTS, weekly_hours: null, source: 'default', updated_by: null, updated_at: null }
  }
  return {
    store_id: storeId,
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
  booking_open_days?: number
  cutoff_minutes?: number
  cancel_free_until_hours?: number
  cancel_late_pct?: number
  no_show_pct?: number
  gap_guard_mode?: 'OFF' | 'STANDARD' | 'STRICT'
  new_client_session_minutes?: 60 | 75 | 90
  /** undefined = keep; null = clear back to unconfigured; object = set. */
  weekly_hours?: WeeklyHours | null
  updated_by?: string | null
}

/** Upsert a store's policy. Partial: omitted fields keep their current value
 *  (or the default on first save). Optional audit commits transactionally. */
export async function setPolicy(
  businessId: string,
  storeId: string,
  input: SetPolicyInput,
  audit?: AuditEventInput,
): Promise<PolicyPublic | null> {
  const store = await prisma.store.findFirst({
    where: { id: storeId, businessId },
    select: { id: true },
  })
  if (!store) return null

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.storeBookingPolicy.upsert({
      where: { storeId },
      create: {
        businessId,
        storeId,
        bookingOpenDays: input.booking_open_days ?? POLICY_DEFAULTS.booking_open_days,
        cutoffMinutes: input.cutoff_minutes ?? POLICY_DEFAULTS.cutoff_minutes,
        cancelFreeUntilHours: input.cancel_free_until_hours ?? POLICY_DEFAULTS.cancel_free_until_hours,
        cancelLatePct: input.cancel_late_pct ?? POLICY_DEFAULTS.cancel_late_pct,
        noShowPct: input.no_show_pct ?? POLICY_DEFAULTS.no_show_pct,
        gapGuardMode: input.gap_guard_mode ?? POLICY_DEFAULTS.gap_guard_mode,
        newClientSessionMinutes: input.new_client_session_minutes ?? POLICY_DEFAULTS.new_client_session_minutes,
        ...(input.weekly_hours != null ? { weeklyHours: input.weekly_hours as Prisma.InputJsonValue } : {}),
        updatedBy: input.updated_by ?? null,
      },
      update: {
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
        updatedBy: input.updated_by ?? null,
      },
    })
    if (audit) {
      await logEventIn(tx, businessId, { ...audit, target_id: audit.target_id ?? storeId })
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
  input: { date: string; reason?: string | null; created_by?: string | null },
  audit?: AuditEventInput,
): Promise<ClosedDayPublic | null> {
  const store = await prisma.store.findFirst({ where: { id: storeId, businessId }, select: { id: true } })
  if (!store) return null
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.storeClosedDay.create({
        data: {
          businessId,
          storeId,
          date: new Date(input.date),
          reason: input.reason ?? null,
          createdBy: input.created_by ?? null,
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
  id: string,
  audit?: AuditEventInput,
): Promise<boolean> {
  const row = await prisma.storeClosedDay.findFirst({
    where: { id, businessId, storeId },
    select: { id: true },
  })
  if (!row) return false
  await prisma.$transaction(async (tx) => {
    await tx.storeClosedDay.delete({ where: { id } })
    if (audit) await logEventIn(tx, businessId, { ...audit, target_id: audit.target_id ?? storeId })
  })
  return true
}
