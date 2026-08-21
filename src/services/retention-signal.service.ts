import { prisma } from '../db/client.js'
import type { RetentionSignalStatus } from '@prisma/client'

// The 引き抜き-detection lane's store. See the schema block + the migration
// header for the legal frame. Two rules dominate every function here:
// (1) HARD deletes on dismissal/expiry/statutory demand — the content of a
//     possibly-wrong AI inference about a named customer must not survive;
//     the app writes audit events (ids+flags only) so the FACT survives.
// (2) Nothing beyond the spec's fields ever gets stored — no staff scores,
//     no LINE-exchange booleans, no characterisation beyond the quote.

export class InvalidSignalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSignalError'
  }
}

const PENDING_TTL_MS = 14 * 86_400_000 // unreviewed rows auto-erase (default 14d)
const CONFIRMED_RETENTION_MS = 365 * 86_400_000 // retention clock (default 1y, pending counsel)

export interface RetentionSignalPublic {
  id: string
  status: RetentionSignalStatus
  occurred_at: string
  karute_record_id: string
  customer_id: string
  staff_id: string
  criterion: string
  confidence: string
  quote: string
  mentioned_business: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  expires_at: string
  created_at: string
}

function toPublic(r: {
  id: string
  status: RetentionSignalStatus
  occurredAt: Date
  karuteRecordId: string
  customerId: string
  staffId: string
  criterion: string
  confidence: string
  quote: string
  mentionedBusiness: string | null
  confirmedBy: string | null
  confirmedAt: Date | null
  expiresAt: Date
  createdAt: Date
}): RetentionSignalPublic {
  return {
    id: r.id,
    status: r.status,
    occurred_at: r.occurredAt.toISOString(),
    karute_record_id: r.karuteRecordId,
    customer_id: r.customerId,
    staff_id: r.staffId,
    criterion: r.criterion,
    confidence: r.confidence,
    quote: r.quote,
    mentioned_business: r.mentionedBusiness,
    confirmed_by: r.confirmedBy,
    confirmed_at: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    expires_at: r.expiresAt.toISOString(),
    created_at: r.createdAt.toISOString(),
  }
}

export interface CreateSignalInput {
  occurred_at: string
  karute_record_id: string
  customer_id: string
  staff_id: string
  criterion: 'A' | 'B' | 'C'
  confidence: 'high' | 'medium'
  quote: string
  mentioned_business?: string | null
}

/** The detection pass's write. Customer and staff must belong to the business
 *  (staff accepts either identity form; card id stored). */
export async function createSignal(
  businessId: string,
  input: CreateSignalInput,
): Promise<RetentionSignalPublic> {
  if (!input.quote || input.quote.trim() === '') {
    throw new InvalidSignalError('quote is required — the verbatim transcript sentence.')
  }
  const customer = await prisma.customer.findFirst({
    where: { id: input.customer_id, businessId },
    select: { id: true },
  })
  if (!customer) throw new InvalidSignalError('Customer not found in this business.')
  const staff = await prisma.staff.findFirst({
    where: { businessId, OR: [{ id: input.staff_id }, { userId: input.staff_id }] },
    select: { id: true },
  })
  if (!staff) throw new InvalidSignalError('Staff not found in this business.')

  const row = await prisma.retentionSignal.create({
    data: {
      businessId,
      occurredAt: new Date(input.occurred_at),
      karuteRecordId: input.karute_record_id,
      customerId: customer.id,
      staffId: staff.id,
      criterion: input.criterion,
      confidence: input.confidence,
      quote: input.quote,
      mentionedBusiness: input.mentioned_business ?? null,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
  })
  return toPublic(row)
}

export interface ListSignalsOptions {
  status?: RetentionSignalStatus
  page?: number
  page_size?: number
}

/** Business-scoped list — the app enforces the dedicated capability gate on
 *  top; core never defaults anything to shared. */
export async function listSignals(
  businessId: string,
  options: ListSignalsOptions = {},
): Promise<{ signals: RetentionSignalPublic[]; total: number; page: number; page_size: number }> {
  const page = options.page ?? 1
  const pageSize = Math.min(options.page_size ?? 50, 200)
  const where: Record<string, unknown> = { businessId }
  if (options.status) where.status = options.status
  const [rows, total] = await Promise.all([
    prisma.retentionSignal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.retentionSignal.count({ where }),
  ])
  return { signals: rows.map(toPublic), total, page, page_size: pageSize }
}

/** Manager confirms: stamps who/when and starts the retention clock. */
export async function confirmSignal(
  businessId: string,
  id: string,
  managerStaffIdOrUserId: string,
): Promise<RetentionSignalPublic | null> {
  const staff = await prisma.staff.findFirst({
    where: { businessId, OR: [{ id: managerStaffIdOrUserId }, { userId: managerStaffIdOrUserId }] },
    select: { id: true },
  })
  if (!staff) throw new InvalidSignalError('Confirming staff not found in this business.')
  const existing = await prisma.retentionSignal.findFirst({ where: { id, businessId } })
  if (!existing) return null
  if (existing.status === 'confirmed') return toPublic(existing) // idempotent
  const row = await prisma.retentionSignal.update({
    where: { id },
    data: {
      status: 'confirmed',
      confirmedBy: staff.id,
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + CONFIRMED_RETENTION_MS),
    },
  })
  return toPublic(row)
}

/** Dismiss = the reviewer says the AI was wrong: HARD delete + anonymized
 *  counter, one transaction — the content never outlives the verdict. */
export async function dismissSignal(businessId: string, id: string): Promise<{ ok: boolean }> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.retentionSignal.findFirst({ where: { id, businessId } })
    if (!row) return { ok: false }
    await tx.retentionSignalDismissal.create({
      data: { businessId, criterion: row.criterion, confidence: row.confidence },
    })
    await tx.retentionSignal.delete({ where: { id } })
    return { ok: true }
  })
}

/** Statutory deletion / retention-clock delete: HARD delete, no counter. */
export async function deleteSignal(businessId: string, id: string): Promise<{ ok: boolean }> {
  const res = await prisma.retentionSignal.deleteMany({ where: { id, businessId } })
  return { ok: res.count > 0 }
}

/** Cron sweep: erase every row past its clock, both statuses, all businesses.
 *  No counters here — expiry is not a reviewer verdict on the rule. */
export async function sweepExpired(): Promise<{ deleted: number }> {
  const res = await prisma.retentionSignal.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return { deleted: res.count }
}

/** Anonymized counters read — auditing the detection rules for over-firing. */
export async function listDismissalCounters(
  businessId: string,
): Promise<{ counters: Array<{ criterion: string; confidence: string; count: number }> }> {
  const rows = await prisma.retentionSignalDismissal.groupBy({
    by: ['criterion', 'confidence'],
    where: { businessId },
    _count: { _all: true },
  })
  return {
    counters: rows.map((r) => ({
      criterion: r.criterion,
      confidence: r.confidence,
      count: r._count._all,
    })),
  }
}
