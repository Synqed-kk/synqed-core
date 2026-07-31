import { prisma } from '../db/client.js'
import { logEventIn, type AuditEventInput } from './audit.service.js'

// Booking-acceptance policy per store (Liam item 3). One row per store;
// absent row = these platform defaults — the numbers reserve shipped with
// hardcoded, so a store with no saved policy behaves exactly as before.
export const POLICY_DEFAULTS = {
  booking_open_days: 30,
  cutoff_minutes: 0,
  cancel_free_until_hours: 24,
  cancel_late_pct: 0,
  no_show_pct: 0,
} as const

export interface PolicyPublic {
  store_id: string
  booking_open_days: number
  cutoff_minutes: number
  cancel_free_until_hours: number
  cancel_late_pct: number
  no_show_pct: number
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
  updatedBy: string | null
  updatedAt: Date
} | null): PolicyPublic {
  if (!r) {
    return { store_id: storeId, ...POLICY_DEFAULTS, source: 'default', updated_by: null, updated_at: null }
  }
  return {
    store_id: storeId,
    booking_open_days: r.bookingOpenDays,
    cutoff_minutes: r.cutoffMinutes,
    cancel_free_until_hours: r.cancelFreeUntilHours,
    cancel_late_pct: r.cancelLatePct,
    no_show_pct: r.noShowPct,
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
