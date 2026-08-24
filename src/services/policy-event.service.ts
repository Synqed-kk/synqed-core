import { prisma } from '../db/client.js'

// Per-staff recording-policy ledger (msg-8 item 11) — the queryable READ side
// of policy acknowledgement. The audit log stays the append-only proof (the
// app still writes those); this table answers "has this person acknowledged
// version N" without pulling a category and filtering app-side. Append-only
// by convention: no update/delete surface exists.

export type PolicyEventKind = 'delivered' | 'acknowledged' | 'revoked'

export interface PolicyEventPublic {
  id: string
  staff_id: string
  policy_line: string
  policy_version: number
  event: PolicyEventKind
  occurred_at: string
}

export async function recordEvent(
  businessId: string,
  input: {
    staff_id: string
    policy_line: string
    policy_version: number
    event: PolicyEventKind
  },
): Promise<PolicyEventPublic> {
  const staff = await prisma.staff.findFirst({
    where: { businessId, OR: [{ id: input.staff_id }, { userId: input.staff_id }] },
    select: { id: true },
  })
  if (!staff) throw new Error('Staff not found')
  const row = await prisma.staffPolicyEvent.create({
    data: {
      businessId,
      staffId: staff.id,
      policyLine: input.policy_line,
      policyVersion: input.policy_version,
      event: input.event,
    },
  })
  return {
    id: row.id,
    staff_id: row.staffId,
    policy_line: row.policyLine,
    policy_version: row.policyVersion,
    event: row.event as PolicyEventKind,
    occurred_at: row.occurredAt.toISOString(),
  }
}

/** Queryable per staff and per version — the two spec'd lenses. */
export async function listEvents(
  businessId: string,
  options: { staff_id?: string; policy_line?: string; policy_version?: number; event?: PolicyEventKind } = {},
): Promise<{ events: PolicyEventPublic[] }> {
  const where: Record<string, unknown> = { businessId }
  if (options.staff_id) {
    const staff = await prisma.staff.findFirst({
      where: { businessId, OR: [{ id: options.staff_id }, { userId: options.staff_id }] },
      select: { id: true },
    })
    where.staffId = staff?.id ?? '00000000-0000-0000-0000-000000000000'
  }
  if (options.policy_line) where.policyLine = options.policy_line
  if (options.policy_version !== undefined) where.policyVersion = options.policy_version
  if (options.event) where.event = options.event
  const rows = await prisma.staffPolicyEvent.findMany({
    where,
    orderBy: { occurredAt: 'asc' },
    take: 1000,
  })
  return {
    events: rows.map((r) => ({
      id: r.id,
      staff_id: r.staffId,
      policy_line: r.policyLine,
      policy_version: r.policyVersion,
      event: r.event as PolicyEventKind,
      occurred_at: r.occurredAt.toISOString(),
    })),
  }
}

/** The enablement check: latest state per (line, version) for one staff —
 *  acknowledged=true only when an 'acknowledged' exists with no later
 *  'revoked'. */
export async function ackState(
  businessId: string,
  staffIdOrUserId: string,
  policyLine: string,
  policyVersion: number,
): Promise<{ delivered: boolean; acknowledged: boolean; revoked: boolean }> {
  const { events } = await listEvents(businessId, {
    staff_id: staffIdOrUserId,
    policy_line: policyLine,
    policy_version: policyVersion,
  })
  let delivered = false
  let acknowledged = false
  let revoked = false
  for (const e of events) {
    if (e.event === 'delivered') delivered = true
    if (e.event === 'acknowledged') { acknowledged = true; revoked = false }
    if (e.event === 'revoked') { revoked = true; acknowledged = false }
  }
  return { delivered, acknowledged, revoked }
}
