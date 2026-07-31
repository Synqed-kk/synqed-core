import { prisma } from '../db/client.js'
import type { Prisma, PricingRuleStatus } from '@prisma/client'

// Dynamic-pricing rules: WHEN the price moves inside the menu band. Menus own
// the band (#55: price_list = ceiling, price_min = floor); a rule set decides
// the multiplier for a given moment. Versioned append-only per store × menu —
// see the schema block for the invariants.

export interface PricingRules {
  /** weekday → hour("0".."23") → multiplier; absent = 1.0 */
  grid?: Partial<Record<Weekday, Record<string, number>>>
  /** date-range promos (inclusive, JST calendar dates); first match wins,
   *  takes precedence over the grid */
  promos?: Array<{ from: string; to: string; multiplier: number; label?: string }>
  /** dashboard display metadata — not used in resolution */
  flex?: number
}

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export interface RuleSetPublic {
  id: string
  business_id: string
  store_id: string
  menu_id: string | null
  version: number
  status: PricingRuleStatus
  rules: PricingRules
  created_by: string | null
  created_at: string
}

function toPublic(r: {
  id: string
  businessId: string
  storeId: string
  menuId: string | null
  version: number
  status: PricingRuleStatus
  rules: Prisma.JsonValue
  createdBy: string | null
  createdAt: Date
}): RuleSetPublic {
  return {
    id: r.id,
    business_id: r.businessId,
    store_id: r.storeId,
    menu_id: r.menuId,
    version: r.version,
    status: r.status,
    rules: r.rules as unknown as PricingRules,
    created_by: r.createdBy,
    created_at: r.createdAt.toISOString(),
  }
}

/** Every ACTIVE set for a store in one read — the BFF's per-availability-call
 *  fetch (menu-specific sets plus the NULL store-default). */
export async function listActive(businessId: string, storeId: string): Promise<RuleSetPublic[]> {
  const rows = await prisma.pricingRuleSet.findMany({
    where: { businessId, storeId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(toPublic)
}

export async function history(
  businessId: string,
  storeId: string,
  menuId: string | null,
): Promise<RuleSetPublic[]> {
  const rows = await prisma.pricingRuleSet.findMany({
    where: { businessId, storeId, menuId },
    orderBy: { version: 'desc' },
  })
  return rows.map(toPublic)
}

/** Save = new version, atomically superseding the current ACTIVE set for the
 *  same (store, menu) scope. The partial unique index backstops the race. */
export async function saveRuleSet(
  businessId: string,
  input: { store_id: string; menu_id?: string | null; rules: PricingRules; created_by?: string | null },
): Promise<RuleSetPublic> {
  const store = await prisma.store.findFirst({
    where: { id: input.store_id, businessId },
    select: { id: true },
  })
  if (!store) throw new Error('Store not found')
  if (input.menu_id) {
    const menu = await prisma.menu.findFirst({
      where: { id: input.menu_id, businessId },
      select: { id: true },
    })
    if (!menu) throw new Error('Menu not found')
  }
  const menuId = input.menu_id ?? null

  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.pricingRuleSet.findFirst({
      where: { businessId, storeId: input.store_id, menuId, status: 'ACTIVE' },
      select: { id: true, version: true },
    })
    if (current) {
      await tx.pricingRuleSet.update({
        where: { id: current.id },
        data: { status: 'SUPERSEDED' },
      })
    }
    return tx.pricingRuleSet.create({
      data: {
        businessId,
        storeId: input.store_id,
        menuId,
        version: (current?.version ?? 0) + 1,
        rules: input.rules as unknown as Prisma.InputJsonValue,
        createdBy: input.created_by ?? null,
      },
    })
  })
  return toPublic(row)
}

/** One-click rollback: re-issue an old version's rules as a NEW version (the
 *  history stays linear and append-only — a rollback is itself an event). */
export async function rollback(
  businessId: string,
  ruleSetId: string,
  actingStaffId?: string | null,
): Promise<RuleSetPublic> {
  const old = await prisma.pricingRuleSet.findFirst({
    where: { id: ruleSetId, businessId },
  })
  if (!old) throw new Error('Rule set not found')
  return saveRuleSet(businessId, {
    store_id: old.storeId,
    menu_id: old.menuId,
    rules: old.rules as unknown as PricingRules,
    created_by: actingStaffId ?? null,
  })
}

// ── Resolution ───────────────────────────────────────────────────────────────

const JST_OFFSET_MS = 9 * 3_600_000

/** Multiplier for a moment, in the salon's clock (JST): promo date match wins,
 *  else the weekday×hour grid, else 1.0. Menu-specific set shadows the
 *  store-default set entirely (no blending — one set owns the answer). */
export function multiplierFor(rules: PricingRules, at: Date): number {
  const jst = new Date(at.getTime() + JST_OFFSET_MS)
  const ymd = jst.toISOString().slice(0, 10)
  for (const p of rules.promos ?? []) {
    if (p.from <= ymd && ymd <= p.to) return p.multiplier
  }
  const weekday = WEEKDAYS[jst.getUTCDay()]
  const hour = String(jst.getUTCHours())
  return rules.grid?.[weekday]?.[hour] ?? 1
}

/** The server-side price of record (Liam item 2): recompute from the ACTIVE
 *  rule set and clamp into the menu band. Client-sent prices are never
 *  trusted when a menu is on the booking. */
export async function computeBookedPrice(
  businessId: string,
  storeId: string | null,
  menuId: string,
  startsAt: Date,
): Promise<{ amount: number; explicitFloor: number | null; currency: string } | null> {
  const menu = await prisma.menu.findFirst({
    where: { id: menuId, businessId },
    select: { priceListAmount: true, priceMinAmount: true, currency: true },
  })
  if (!menu) return null

  let mult = 1
  if (storeId) {
    const sets = await prisma.pricingRuleSet.findMany({
      where: { businessId, storeId, status: 'ACTIVE', OR: [{ menuId }, { menuId: null }] },
    })
    const specific = sets.find((s) => s.menuId === menuId)
    const fallback = sets.find((s) => s.menuId === null)
    const chosen = specific ?? fallback
    if (chosen) mult = multiplierFor(chosen.rules as unknown as PricingRules, startsAt)
  }

  const ceiling = menu.priceListAmount
  // Band semantics (#55): NULL price_min = fixed — RULES cannot move the price.
  const floor = menu.priceMinAmount ?? menu.priceListAmount
  const raw = Math.round(menu.priceListAmount * mult)
  const amount = Math.min(ceiling, Math.max(floor, raw))
  return { amount, explicitFloor: menu.priceMinAmount, currency: menu.currency }
}
