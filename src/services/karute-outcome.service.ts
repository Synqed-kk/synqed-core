import { prisma } from '../db/client.js'
import { Prisma } from '@prisma/client'

// CLOSING RATE (the one authoritative definition — Liam 8/7): 
//   closing_rate = success / (success + no_deal)
// 'revisit' (existing customer's normal visit) and 'pending' are excluded
// from BOTH numerator and denominator. Anything consuming an outcomes
// summary must use this formula.

export interface KaruteOutcomePublic {
  karute_record_id: string
  customer_id: string | null
  outcome: string
  reason: string | null
  /** 'conversion' (first-visit close) | 'repurchase' — which question set
   *  the staff answered; re-opening an outcome must show the same set. */
  decision_context: string | null
  is_first_visit: boolean
  decided_by: string | null
  decided_at: string | null
  auto_decided: boolean
}

function toPublic(row: {
  karuteRecordId: string
  customerId: string | null
  outcome: string
  reason: string | null
  decisionContext: string | null
  isFirstVisit: boolean
  decidedBy: string | null
  decidedAt: Date | null
  autoDecided: boolean
}): KaruteOutcomePublic {
  return {
    karute_record_id: row.karuteRecordId,
    customer_id: row.customerId,
    outcome: row.outcome,
    reason: row.reason,
    decision_context: row.decisionContext,
    is_first_visit: row.isFirstVisit,
    decided_by: row.decidedBy,
    decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
    auto_decided: row.autoDecided,
  }
}

/** Read a session's outcome (business-scoped), or null if none recorded. */
export async function getOutcome(
  businessId: string,
  karuteRecordId: string,
): Promise<KaruteOutcomePublic | null> {
  const row = await prisma.karuteOutcome.findFirst({
    where: { karuteRecordId, businessId },
  })
  return row ? toPublic(row) : null
}

export interface UpsertOutcomeInput {
  karute_record_id: string
  customer_id?: string | null
  outcome: string
  reason?: string | null
  decision_context?: string | null
  is_first_visit?: boolean
  decided_by?: string | null
  decided_at?: string | null
  auto_decided?: boolean
}

/** Upsert a session's outcome, keyed on karute_record_id within the business. */
export async function upsertOutcome(
  businessId: string,
  input: UpsertOutcomeInput,
): Promise<KaruteOutcomePublic> {
  const data = {
    customerId: input.customer_id ?? null,
    outcome: input.outcome,
    reason: input.reason ?? null,
    decisionContext: input.decision_context ?? null,
    isFirstVisit: input.is_first_visit ?? false,
    decidedBy: input.decided_by ?? null,
    decidedAt: input.decided_at ? new Date(input.decided_at) : null,
    autoDecided: input.auto_decided ?? false,
  }
  const row = await prisma.karuteOutcome.upsert({
    where: { karuteRecordId: input.karute_record_id },
    create: { karuteRecordId: input.karute_record_id, businessId, ...data },
    update: data,
  })
  return toPublic(row)
}

export interface ListOutcomesOptions {
  /** Permanent staff card that owns the karute record, not decided_by. */
  staff_id?: string
  karute_record_id?: string
  outcome?: string
  decision_context?: string
  /** Rows last touched strictly BEFORE this instant — the pending-auto-close
   *  cron's age filter (e.g. now - 14d). */
  updated_before?: string
  page?: number
  page_size?: number
}

/** Business-scoped outcome list — built for the auto-close cron (find
 *  'pending' conversion outcomes older than N days) but generally filterable. */
export async function listOutcomes(
  businessId: string,
  options: ListOutcomesOptions = {},
): Promise<{ outcomes: KaruteOutcomePublic[]; total: number; page: number; page_size: number }> {
  const page = options.page ?? 1
  const pageSize = Math.min(options.page_size ?? 100, 500)
  const conditions = [Prisma.sql`o.business_id = ${businessId}::uuid`]
  if (options.outcome) conditions.push(Prisma.sql`o.outcome = ${options.outcome}`)
  if (options.decision_context) conditions.push(Prisma.sql`o.decision_context = ${options.decision_context}`)
  if (options.updated_before) conditions.push(Prisma.sql`o.updated_at < ${new Date(options.updated_before)}`)
  if (options.karute_record_id) conditions.push(Prisma.sql`o.karute_record_id = ${options.karute_record_id}::uuid`)
  // EXISTS avoids loading a staff member's entire record history into an IN
  // list. Both the record and outcome must belong to the caller's business.
  if (options.staff_id) conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM karute_records r WHERE r.id = o.karute_record_id
    AND r.business_id = o.business_id AND r.staff_id = ${options.staff_id}::uuid
  )`)
  const where = Prisma.join(conditions, ' AND ')
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<Array<Omit<KaruteOutcomePublic, 'decided_at'> & { decided_at: Date | null }>>(Prisma.sql`
      SELECT o.karute_record_id, o.customer_id, o.outcome, o.reason,
        o.decision_context, o.is_first_visit, o.decided_by, o.decided_at, o.auto_decided
      FROM karute_outcomes o WHERE ${where}
      ORDER BY o.updated_at ASC, o.karute_record_id ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total FROM karute_outcomes o WHERE ${where}`),
  ])
  return { outcomes: rows.map(row => ({ ...row, decided_at: row.decided_at?.toISOString() ?? null })), total: Number(counts[0].total), page, page_size: pageSize }
}
