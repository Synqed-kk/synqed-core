import { prisma } from '../db/client.js'
import type { Prisma } from '@prisma/client'

// The real 監査ログ (wave 1+2). One write path — app and core both log through
// logEvent. Append-only is enforced IN THE DB (trigger); erasure goes through
// the SECURITY DEFINER scrub only. Don't add FKs here — see the migration.

export interface AuditEventInput {
  store_id?: string | null
  actor_id?: string | null
  actor_type: string
  actor_role?: string | null
  /** Display-name snapshot; when omitted and actor_id is a staff/auth id,
   *  the service resolves it from the staff roster at write time. */
  actor_label?: string | null
  category: string
  action: string
  target_type?: string | null
  target_id?: string | null
  target_label?: string | null
  detail?: unknown
  break_glass?: boolean
  severity?: string
}

export interface AuditEventPublic {
  id: string
  business_id: string
  store_id: string | null
  at: string
  actor_id: string | null
  actor_type: string
  actor_role: string | null
  actor_label: string | null
  category: string
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  detail: unknown
  break_glass: boolean
  severity: string
}

const DETAIL_CAP_BYTES = 2048

function toPublic(r: {
  id: string
  businessId: string
  storeId: string | null
  at: Date
  actorId: string | null
  actorType: string
  actorRole: string | null
  actorLabel: string | null
  category: string
  action: string
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  detail: Prisma.JsonValue | null
  breakGlass: boolean
  severity: string
}): AuditEventPublic {
  return {
    id: r.id,
    business_id: r.businessId,
    store_id: r.storeId,
    at: r.at.toISOString(),
    actor_id: r.actorId,
    actor_type: r.actorType,
    actor_role: r.actorRole,
    actor_label: r.actorLabel,
    category: r.category,
    action: r.action,
    target_type: r.targetType,
    target_id: r.targetId,
    target_label: r.targetLabel,
    detail: r.detail,
    break_glass: r.breakGlass,
    severity: r.severity,
  }
}

export async function logEvent(
  businessId: string,
  input: AuditEventInput,
): Promise<AuditEventPublic> {
  // Cap detail at ~2KB so a runaway payload can't bloat the log; truncation is
  // recorded so the reader knows it happened.
  let detail = input.detail
  if (detail !== undefined && detail !== null) {
    const raw = JSON.stringify(detail)
    if (Buffer.byteLength(raw, 'utf8') > DETAIL_CAP_BYTES) {
      detail = { truncated: true, head: raw.slice(0, DETAIL_CAP_BYTES) }
    }
  }
  // Actor-name snapshot: copy the display name INTO the row (like
  // target_label) so history survives staff deletion. Caller-supplied label
  // wins; else resolve from the roster — actor_id may be a synqed staff id
  // OR an auth user uuid (staff.user_id), the app sends the latter.
  let actorLabel = input.actor_label ?? null
  if (!actorLabel && input.actor_id) {
    const staffRow = await prisma.staff
      .findFirst({
        where: {
          businessId,
          OR: [{ id: input.actor_id }, { userId: input.actor_id }],
        },
        select: { name: true },
      })
      .catch(() => null)
    actorLabel = staffRow?.name ?? null
  }

  const row = await prisma.auditLog.create({
    data: {
      businessId,
      storeId: input.store_id ?? null,
      actorId: input.actor_id ?? null,
      actorType: input.actor_type,
      actorRole: input.actor_role ?? null,
      actorLabel,
      category: input.category,
      action: input.action,
      targetType: input.target_type ?? null,
      targetId: input.target_id ?? null,
      targetLabel: input.target_label ?? null,
      detail: detail === undefined ? undefined : (detail as Prisma.InputJsonValue),
      breakGlass: input.break_glass ?? false,
      severity: input.severity ?? 'info',
    },
  })
  return toPublic(row)
}

export interface ListAuditOptions {
  category?: string
  actor_id?: string
  target_type?: string
  target_id?: string
  break_glass?: boolean
  /** Exact-match severity filter (info | warn | critical). */
  severity?: string
  /** Store lens for the store-scoped manager view (rows may be null-store). */
  store_id?: string
  /** True → exclude view events ("everything except views" server-side, so
   *  the summary strip's 変更/警告 totals stay exact past page one). A view is
   *  any action named '*.view' or 'view' — the emitter's naming convention. */
  exclude_views?: boolean
  from?: string
  to?: string
  page?: number
  page_size?: number
}

export async function listAuditLog(
  businessId: string,
  options: ListAuditOptions = {},
): Promise<{ events: AuditEventPublic[]; total: number; page: number; page_size: number }> {
  const page = options.page ?? 1
  const pageSize = Math.min(options.page_size ?? 50, 200)
  const where: Record<string, unknown> = { businessId }
  if (options.category) where.category = options.category
  if (options.actor_id) where.actorId = options.actor_id
  if (options.target_type) where.targetType = options.target_type
  if (options.target_id) where.targetId = options.target_id
  if (options.break_glass !== undefined) where.breakGlass = options.break_glass
  if (options.severity) where.severity = options.severity
  if (options.store_id) where.storeId = options.store_id
  if (options.exclude_views) {
    where.NOT = [{ action: { endsWith: '.view' } }, { action: 'view' }]
  }
  if (options.from || options.to) {
    const at: Record<string, Date> = {}
    if (options.from) at.gte = new Date(options.from)
    if (options.to) at.lte = new Date(options.to)
    where.at = at
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ])
  return { events: rows.map(toPublic), total, page, page_size: pageSize }
}

/** Erasure hook for a hard customer deletion — the ONLY mutation path. */
export async function scrubCustomer(businessId: string, customerId: string): Promise<number> {
  const rows = await prisma.$queryRaw<[{ audit_log_scrub_customer: number }]>`
    SELECT audit_log_scrub_customer(${businessId}::uuid, ${customerId}::uuid)`
  return Number(rows[0]?.audit_log_scrub_customer ?? 0)
}
