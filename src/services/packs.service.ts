import { prisma } from '../db/client.js'

// 回数券 (ticket-pack) subsystem data access — business-scoped. The karute app
// keeps the usage aggregation (FIFO / 残 counts); core serves the rows. No
// PostgREST 1000-row cap here (Prisma), so list endpoints return full sets.

// ─── ticket_packs ────────────────────────────────────────────────────────────

export interface PackPublic {
  id: string
  customer_id: string
  kind: string
  pack_size: number
  unit_price: number
  total_price: number | null
  purchase_round: number
  purchased_at: string | null
  source: string
  status: string
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function packToPublic(p: {
  id: string; customerId: string; kind: string; packSize: number; unitPrice: number
  totalPrice: number | null; purchaseRound: number; purchasedAt: Date | null; source: string
  status: string; notes: string | null; createdBy: string | null; createdAt: Date; updatedAt: Date
}): PackPublic {
  return {
    id: p.id, customer_id: p.customerId, kind: p.kind, pack_size: p.packSize, unit_price: p.unitPrice,
    total_price: p.totalPrice, purchase_round: p.purchaseRound,
    purchased_at: p.purchasedAt ? p.purchasedAt.toISOString().slice(0, 10) : null,
    source: p.source, status: p.status, notes: p.notes, created_by: p.createdBy,
    created_at: p.createdAt.toISOString(), updated_at: p.updatedAt.toISOString(),
  }
}

export async function listPacksByCustomer(businessId: string, customerId: string): Promise<PackPublic[]> {
  const rows = await prisma.ticketPack.findMany({
    where: { businessId, customerId },
    orderBy: [{ purchasedAt: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.map(packToPublic)
}

/** All ACTIVE packs (slim) for the bulk usage aggregation, FIFO-ordered. */
export async function listActivePacks(businessId: string): Promise<
  Array<{ id: string; customer_id: string; kind: string; pack_size: number; unit_price: number }>
> {
  const rows = await prisma.ticketPack.findMany({
    where: { businessId, status: 'active' },
    select: { id: true, customerId: true, kind: true, packSize: true, unitPrice: true },
    orderBy: [{ purchasedAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map((r) => ({ id: r.id, customer_id: r.customerId, kind: r.kind, pack_size: r.packSize, unit_price: r.unitPrice }))
}

export interface CreatePackInput {
  customer_id: string; kind: string; pack_size: number; unit_price: number
  total_price?: number | null; purchase_round?: number; purchased_at?: string | null
  source?: string; notes?: string | null; created_by?: string | null
}

export async function createPack(businessId: string, input: CreatePackInput): Promise<PackPublic> {
  const row = await prisma.ticketPack.create({
    data: {
      businessId, customerId: input.customer_id, kind: input.kind,
      packSize: input.pack_size, unitPrice: input.unit_price,
      totalPrice: input.total_price ?? null, purchaseRound: input.purchase_round ?? 0,
      purchasedAt: input.purchased_at ? new Date(input.purchased_at) : null,
      source: input.source ?? 'manual', status: 'active',
      notes: input.notes ?? null, createdBy: input.created_by ?? null,
    },
  })
  return packToPublic(row)
}

export async function updatePackStatus(businessId: string, id: string, status: string): Promise<{ ok: boolean }> {
  const res = await prisma.ticketPack.updateMany({ where: { id, businessId }, data: { status } })
  return { ok: res.count > 0 }
}

// ─── pack_redemptions ────────────────────────────────────────────────────────

export interface RedemptionPublic {
  id: string; pack_id: string; customer_id: string; redeemed_on: string
  appointment_id: string | null; karute_record_id: string | null; source: string
  created_by: string | null; created_at: string
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function listRedemptionsByCustomer(
  businessId: string, customerId: string,
): Promise<Array<{ pack_id: string; redeemed_on: string }>> {
  const rows = await prisma.packRedemption.findMany({
    where: { businessId, customerId }, select: { packId: true, redeemedOn: true },
  })
  return rows.map((r) => ({ pack_id: r.packId, redeemed_on: ymd(r.redeemedOn) }))
}

/** All redemption pack_ids for the bulk usage aggregation. */
export async function listAllRedemptionPackIds(businessId: string): Promise<string[]> {
  const rows = await prisma.packRedemption.findMany({ where: { businessId }, select: { packId: true } })
  return rows.map((r) => r.packId)
}

export async function listRecentRedemptions(
  businessId: string, since: string,
): Promise<Array<{
  customer_id: string; appointment_id: string | null; redeemed_on: string
  pack_id: string; unit_price: number | null
}>> {
  const rows = await prisma.packRedemption.findMany({
    where: { businessId, redeemedOn: { gte: new Date(since) } },
    select: { customerId: true, appointmentId: true, redeemedOn: true, packId: true },
    orderBy: { redeemedOn: 'asc' },
  })
  // Price each redemption from its pack — by id, NOT status-filtered: a burn
  // on a since-exhausted/cancelled pack still moved that money when it
  // happened, and active-only pricing would silently drop exactly the packs
  // most likely to have burned recently (the ones that just hit zero).
  const packIds = [...new Set(rows.map((r) => r.packId))]
  const packs = packIds.length
    ? await prisma.ticketPack.findMany({
        where: { businessId, id: { in: packIds } },
        select: { id: true, unitPrice: true },
      })
    : []
  const priceById = new Map(packs.map((p) => [p.id, p.unitPrice]))
  // unit_price null = orphaned redemption (pack row gone) — consumers must
  // treat the sum as unpriceable rather than skip the row (undercount).
  return rows.map((r) => ({
    customer_id: r.customerId, appointment_id: r.appointmentId, redeemed_on: ymd(r.redeemedOn),
    pack_id: r.packId, unit_price: priceById.get(r.packId) ?? null,
  }))
}

export interface AddRedemptionInput {
  pack_id: string; customer_id: string; redeemed_on: string
  appointment_id?: string | null; karute_record_id?: string | null; source?: string; created_by?: string | null
  counts_as_visit?: boolean
}

export async function addRedemption(businessId: string, input: AddRedemptionInput): Promise<{ id: string }> {
  const row = await prisma.packRedemption.create({
    data: {
      businessId, packId: input.pack_id, customerId: input.customer_id,
      redeemedOn: new Date(input.redeemed_on), appointmentId: input.appointment_id ?? null,
      karuteRecordId: input.karute_record_id ?? null, source: input.source ?? 'manual',
      createdBy: input.created_by ?? null,
      countsAsVisit: input.counts_as_visit ?? true,
    },
    select: { id: true },
  })
  return { id: row.id }
}

export async function removeRedemption(businessId: string, id: string): Promise<{ ok: boolean }> {
  const res = await prisma.packRedemption.deleteMany({ where: { id, businessId } })
  return { ok: res.count > 0 }
}

// ─── customer_lifecycle ──────────────────────────────────────────────────────

export interface LifecyclePublic { customer_id: string; status: string; referral: boolean }

export async function getLifecycle(businessId: string, customerId: string): Promise<LifecyclePublic | null> {
  const row = await prisma.customerLifecycle.findFirst({ where: { customerId, businessId } })
  return row ? { customer_id: row.customerId, status: row.status, referral: row.referral } : null
}

export async function listLifecycles(businessId: string): Promise<LifecyclePublic[]> {
  const rows = await prisma.customerLifecycle.findMany({
    where: { businessId }, select: { customerId: true, status: true, referral: true },
  })
  return rows.map((r) => ({ customer_id: r.customerId, status: r.status, referral: r.referral }))
}

/** Upsert lifecycle. status_changed_at (the churn-model LABEL DATE) is written
 *  ONLY on an actual status transition — never on a blind referral toggle. */
export async function setLifecycle(
  businessId: string,
  input: { customer_id: string; status: string; referral: boolean; updated_by?: string | null; reason?: string | null },
): Promise<{ ok: boolean }> {
  const existing = await prisma.customerLifecycle.findFirst({
    where: { customerId: input.customer_id, businessId }, select: { status: true },
  })
  const statusChanged = existing?.status !== input.status
  const base = { businessId, status: input.status, referral: input.referral, updatedBy: input.updated_by ?? null }
  const changeFields = statusChanged ? { statusChangedAt: new Date(), reason: input.reason ?? null } : {}
  await prisma.customerLifecycle.upsert({
    where: { customerId: input.customer_id },
    create: { customerId: input.customer_id, ...base, ...changeFields },
    update: { ...base, ...changeFields },
  })
  return { ok: true }
}

// ─── pack_alert_dismissals ───────────────────────────────────────────────────

export async function listAlertDismissals(
  businessId: string,
): Promise<Array<{ customer_id: string; expires_at: string | null }>> {
  const rows = await prisma.packAlertDismissal.findMany({
    where: { businessId }, select: { customerId: true, expiresAt: true },
  })
  return rows.map((r) => ({ customer_id: r.customerId, expires_at: r.expiresAt ? r.expiresAt.toISOString() : null }))
}

export async function addAlertDismissal(
  businessId: string,
  input: { customer_id: string; dismissed_by: string; reason?: string | null; expires_at?: string | null },
): Promise<{ ok: boolean }> {
  await prisma.packAlertDismissal.create({
    data: {
      businessId, customerId: input.customer_id, dismissedBy: input.dismissed_by,
      reason: input.reason ?? null, expiresAt: input.expires_at ? new Date(input.expires_at) : null,
    },
  })
  return { ok: true }
}

// ─── customer_contacts ───────────────────────────────────────────────────────

export async function addContact(
  businessId: string,
  input: { customer_id: string; channel: string; alert_kind?: string | null; note?: string | null; contacted_by: string },
): Promise<{ ok: boolean }> {
  await prisma.customerContact.create({
    data: {
      businessId, customerId: input.customer_id, channel: input.channel,
      alertKind: input.alert_kind ?? null, note: input.note ?? null, contactedBy: input.contacted_by,
    },
  })
  return { ok: true }
}

export async function listRecentContacts(
  businessId: string, since: string,
): Promise<Array<{ customer_id: string; contacted_at: string }>> {
  const rows = await prisma.customerContact.findMany({
    where: { businessId, contactedAt: { gte: new Date(since) } },
    select: { customerId: true, contactedAt: true }, orderBy: { contactedAt: 'desc' },
  })
  return rows.map((r) => ({ customer_id: r.customerId, contacted_at: r.contactedAt.toISOString() }))
}

// ─── visit_reconcile_dismissals ──────────────────────────────────────────────

export async function addVisitDismissal(
  businessId: string,
  input: { customer_id: string; appointment_id?: string | null; visit_day: string; dismissed_by: string; reason?: string | null },
): Promise<{ ok: boolean }> {
  await prisma.visitReconcileDismissal.create({
    data: {
      businessId, customerId: input.customer_id, appointmentId: input.appointment_id ?? null,
      visitDay: new Date(input.visit_day), dismissedBy: input.dismissed_by, reason: input.reason ?? null,
    },
  })
  return { ok: true }
}

export async function listVisitDismissals(
  businessId: string, since: string,
): Promise<Array<{ customer_id: string; appointment_id: string | null; visit_day: string }>> {
  const rows = await prisma.visitReconcileDismissal.findMany({
    where: { businessId, visitDay: { gte: new Date(since) } },
    select: { customerId: true, appointmentId: true, visitDay: true }, orderBy: { visitDay: 'asc' },
  })
  return rows.map((r) => ({ customer_id: r.customerId, appointment_id: r.appointmentId, visit_day: ymd(r.visitDay) }))
}
