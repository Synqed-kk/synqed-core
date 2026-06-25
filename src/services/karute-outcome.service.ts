import { prisma } from '../db/client.js'

export interface KaruteOutcomePublic {
  karute_record_id: string
  customer_id: string | null
  outcome: string
  reason: string | null
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
