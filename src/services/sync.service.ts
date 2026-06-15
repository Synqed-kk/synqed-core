import { prisma } from '../db/client.js'
import { decryptJson, encryptJson } from './crypto.js'
import {
  mapReservation,
  qrGetReservations,
  qrLogin,
  type MappedQRReservation,
  type QRSession,
} from './quickreserve.js'
import type {
  SyncProvider,
  SyncStatus,
  AppointmentSource,
  AppointmentStatus,
} from '@prisma/client'

// =============================================================================
// Types exposed via HTTP
// =============================================================================

export interface SyncConfigPublic {
  id: string
  business_id: string
  provider: SyncProvider
  username: string | null
  store_slug: string | null
  store_id: number | null
  enabled: boolean
  interval_minutes: number
  business_hours_start: number
  business_hours_end: number
  timezone: string
  lookahead_days: number
  last_run_at: string | null
  last_run_status: SyncStatus | null
  last_run_error: string | null
  last_run_stats: unknown
  created_at: string
  updated_at: string
  has_credentials: boolean
}

export interface SyncConfigInput {
  username?: string
  password?: string
  store_slug?: string
  store_id?: number
  enabled?: boolean
  interval_minutes?: number
  business_hours_start?: number
  business_hours_end?: number
  timezone?: string
  lookahead_days?: number
}

export interface SyncRunResult {
  date_window: { start: string; end: string }
  total_fetched: number
  created: number
  updated: number
  cancelled: number
  skipped_no_staff: number
  skipped_deleted: number
  skipped_error: number
  unmatched_staff: string[]
  duration_ms: number
}

interface QRCredentials {
  username: string
  password: string
  storeSlug: string
  storeId: number
}

// =============================================================================
// Config CRUD
// =============================================================================

function toPublic(row: {
  id: string
  businessId: string
  provider: SyncProvider
  username: string | null
  storeSlug: string | null
  storeId: number | null
  enabled: boolean
  intervalMinutes: number
  businessHoursStart: number
  businessHoursEnd: number
  timezone: string
  lookaheadDays: number
  lastRunAt: Date | null
  lastRunStatus: SyncStatus | null
  lastRunError: string | null
  lastRunStats: unknown
  createdAt: Date
  updatedAt: Date
  credentialsEncrypted: Uint8Array<ArrayBuffer> | null
}): SyncConfigPublic {
  return {
    id: row.id,
    business_id: row.businessId,
    provider: row.provider,
    username: row.username,
    store_slug: row.storeSlug,
    store_id: row.storeId,
    enabled: row.enabled,
    interval_minutes: row.intervalMinutes,
    business_hours_start: row.businessHoursStart,
    business_hours_end: row.businessHoursEnd,
    timezone: row.timezone,
    lookahead_days: row.lookaheadDays,
    last_run_at: row.lastRunAt?.toISOString() ?? null,
    last_run_status: row.lastRunStatus,
    last_run_error: row.lastRunError,
    last_run_stats: row.lastRunStats,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    has_credentials: row.credentialsEncrypted !== null,
  }
}

export async function getConfig(
  businessId: string,
  provider: SyncProvider,
): Promise<SyncConfigPublic | null> {
  const row = await prisma.syncConfig.findUnique({
    where: { businessId_provider: { businessId, provider } },
  })
  return row ? toPublic(row) : null
}

export async function upsertConfig(
  businessId: string,
  provider: SyncProvider,
  input: SyncConfigInput,
): Promise<SyncConfigPublic> {
  // If password is provided, encrypt the full credential envelope.
  // Otherwise leave existing ciphertext untouched.
  let credentialsEncrypted: Uint8Array<ArrayBuffer> | undefined
  if (input.password !== undefined) {
    if (provider === 'QUICKRESERVE') {
      const existing = await prisma.syncConfig.findUnique({
        where: { businessId_provider: { businessId, provider } },
      })
      const creds: QRCredentials = {
        username: input.username ?? existing?.username ?? '',
        password: input.password,
        storeSlug: input.store_slug ?? existing?.storeSlug ?? '',
        storeId: input.store_id ?? existing?.storeId ?? 0,
      }
      credentialsEncrypted = encryptJson(creds)
    }
  }

  const row = await prisma.syncConfig.upsert({
    where: { businessId_provider: { businessId, provider } },
    create: {
      businessId,
      provider,
      username: input.username,
      storeSlug: input.store_slug,
      storeId: input.store_id,
      enabled: input.enabled ?? false,
      intervalMinutes: input.interval_minutes ?? 15,
      businessHoursStart: input.business_hours_start ?? 8,
      businessHoursEnd: input.business_hours_end ?? 22,
      timezone: input.timezone ?? 'Asia/Tokyo',
      lookaheadDays: input.lookahead_days ?? 7,
      credentialsEncrypted,
    },
    update: {
      username: input.username ?? undefined,
      storeSlug: input.store_slug ?? undefined,
      storeId: input.store_id ?? undefined,
      enabled: input.enabled ?? undefined,
      intervalMinutes: input.interval_minutes ?? undefined,
      businessHoursStart: input.business_hours_start ?? undefined,
      businessHoursEnd: input.business_hours_end ?? undefined,
      timezone: input.timezone ?? undefined,
      lookaheadDays: input.lookahead_days ?? undefined,
      ...(credentialsEncrypted !== undefined ? { credentialsEncrypted } : {}),
    },
  })
  return toPublic(row)
}

// =============================================================================
// Master dispatch (cron)
// =============================================================================

/**
 * Called by Vercel Cron every 15 minutes. Finds every enabled config that is
 * due (past last_run_at + interval_minutes, within business hours in its own
 * timezone) and runs it. Tenants with errors get skipped with exponential
 * backoff left as a TODO — today we just retry on the next tick.
 */
export async function dispatchCron(): Promise<{ dispatched: number; skipped: number }> {
  const now = new Date()
  const enabledConfigs = await prisma.syncConfig.findMany({
    where: { enabled: true },
  })

  let dispatched = 0
  let skipped = 0

  for (const config of enabledConfigs) {
    if (!isDue(config, now)) {
      skipped++
      continue
    }
    if (!isWithinBusinessHours(config, now)) {
      skipped++
      continue
    }
    // Fire-and-forget per tenant so one failure doesn't block the others.
    // Errors are captured into last_run_status inside runSyncForTenant.
    try {
      await runSyncForTenant(config.businessId, config.provider)
      dispatched++
    } catch (err) {
      console.error(`[cron] sync failed for ${config.businessId}/${config.provider}`, err)
      dispatched++ // still counts as dispatched; status row written in runSyncForTenant
    }
  }

  return { dispatched, skipped }
}

function isDue(
  config: { lastRunAt: Date | null; intervalMinutes: number },
  now: Date,
): boolean {
  if (!config.lastRunAt) return true
  const dueAt = new Date(config.lastRunAt.getTime() + config.intervalMinutes * 60_000)
  return now >= dueAt
}

function isWithinBusinessHours(
  config: { businessHoursStart: number; businessHoursEnd: number; timezone: string },
  now: Date,
): boolean {
  const hour = getHourInTimezone(now, config.timezone)
  if (config.businessHoursStart <= config.businessHoursEnd) {
    return hour >= config.businessHoursStart && hour < config.businessHoursEnd
  }
  // Wraps midnight (e.g. 22–6)
  return hour >= config.businessHoursStart || hour < config.businessHoursEnd
}

function getHourInTimezone(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(date)
  const hourPart = parts.find((p) => p.type === 'hour')
  return hourPart ? Number(hourPart.value) % 24 : 0
}

// =============================================================================
// Manual / per-tenant run
// =============================================================================

export async function runSyncForTenant(
  businessId: string,
  provider: SyncProvider,
): Promise<SyncRunResult> {
  const config = await prisma.syncConfig.findUnique({
    where: { businessId_provider: { businessId, provider } },
  })
  if (!config) throw new Error('Sync config not found')
  if (!config.credentialsEncrypted) throw new Error('No credentials set for this provider')

  // Mark running so concurrent dispatch ticks don't stomp
  await prisma.syncConfig.update({
    where: { id: config.id },
    data: { lastRunStatus: 'RUNNING' as SyncStatus },
  })

  const startedAt = Date.now()
  try {
    let result: SyncRunResult
    if (provider === 'QUICKRESERVE') {
      const creds = decryptJson<QRCredentials>(config.credentialsEncrypted)
      result = await runQuickReserveSync(businessId, config, creds)
    } else {
      throw new Error(`Provider not implemented: ${provider}`)
    }

    await prisma.syncConfig.update({
      where: { id: config.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: 'OK',
        lastRunError: null,
        lastRunStats: result as unknown as object,
      },
    })

    return { ...result, duration_ms: Date.now() - startedAt }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await prisma.syncConfig.update({
      where: { id: config.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: 'ERROR',
        lastRunError: message,
      },
    })
    throw err
  }
}

// =============================================================================
// Quick Reserve sync logic (the 6 robustness fixes live here)
// =============================================================================

interface QRSyncConfig {
  businessId: string
  storeSlug: string | null
  storeId: number | null
  lookaheadDays: number
  timezone: string
}

async function runQuickReserveSync(
  businessId: string,
  config: QRSyncConfig,
  creds: QRCredentials,
): Promise<SyncRunResult> {
  const storeSlug = config.storeSlug ?? creds.storeSlug
  const storeId = config.storeId ?? creds.storeId
  if (!storeSlug || !storeId) {
    throw new Error('Store slug / id missing from QR config')
  }

  const session = await qrLogin(storeSlug, creds.username, creds.password)
  const { dateStrings, windowStart, windowEnd } = buildDateWindow(
    new Date(),
    config.lookaheadDays,
    config.timezone,
  )

  // Fetch reservations across the date window
  const allReservations: MappedQRReservation[] = []
  let totalFetched = 0
  for (const date of dateStrings) {
    const raw = await qrGetReservations(session, storeSlug, storeId, date)
    totalFetched += raw.length
    for (const r of raw) allReservations.push(mapReservation(r))
  }

  // Load staff for this tenant (for name matching)
  const tenantStaff = await prisma.staff.findMany({
    where: { businessId, isActive: true },
    select: { id: true, name: true, nameKana: true },
  })

  let created = 0
  let updated = 0
  let cancelled = 0
  let skippedNoStaff = 0
  let skippedDeleted = 0
  let skippedError = 0
  // Orphan-cancellation infers "cancelled" from "not in seenAppointmentIds".
  // That inference is only trustworthy if we could account for every record.
  // If a per-record error AND its best-effort appointment re-lookup both fail
  // (a systemic DB fault — pool exhaustion, outage), the seen-set is missing
  // live appointments, and cancelling on its absence would mass-cancel real
  // bookings. This flag goes false the moment that happens → we skip the
  // cancellation pass rather than risk nuking the tenant's schedule.
  let cancellationSafe = true
  const unmatchedStaff = new Set<string>()

  const seenAppointmentIds: string[] = []

  for (const r of allReservations) {
    if (r.deleted) {
      skippedDeleted++
      continue
    }

    // --- Staff match: exact → substring → log unmatched ---
    const staffId = matchStaff(r.staffName, tenantStaff)
    if (!staffId) {
      unmatchedStaff.add(r.staffName)
      skippedNoStaff++
      continue
    }

    // Per-record resilience: a single reservation that throws (e.g. a
    // karuteNumber race the retry loop couldn't win, or a transient DB error)
    // must NOT abort the rest of the tenant's batch. Log it, count it, and
    // move on — the record gets picked up on the next sync (idempotent).
    try {
      // --- Customer find-or-create by QR id → fall back to (tenant, name) ---
      const customerId = await findOrCreateCustomer(businessId, r)

      // --- Appointment upsert by externalRefs.quickreserve.reservationId ---
      const existing = await findAppointmentByQrId(businessId, r.qrReservationId)
      if (existing) {
        await prisma.appointment.update({
          where: { id: existing.id },
          data: {
            customerId,
            staffId,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            durationMinutes: r.durationMinutes,
            title: r.treatmentName,
            notes: buildNotes(r),
            status: 'SCHEDULED' as AppointmentStatus,
            source: 'QUICKRESERVE' as AppointmentSource,
            cancelledAt: null,
          },
        })
        seenAppointmentIds.push(existing.id)
        updated++
      } else {
        const row = await prisma.appointment.create({
          data: {
            businessId,
            customerId,
            staffId,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            durationMinutes: r.durationMinutes,
            title: r.treatmentName,
            notes: buildNotes(r),
            status: 'SCHEDULED' as AppointmentStatus,
            source: 'QUICKRESERVE' as AppointmentSource,
            externalRefs: {
              quickreserve: {
                reservationId: r.qrReservationId,
                rid: r.qrRid,
                customerId: r.qrCustomerId,
                staffId: r.qrStaffId,
                treatmentId: r.treatmentId,
              },
            },
          },
        })
        seenAppointmentIds.push(row.id)
        created++
      }
    } catch (err) {
      skippedError++
      console.error(
        `[sync] skipped reservation ${r.qrReservationId} (QR customer ${r.qrCustomerId}):`,
        err,
      )
      // This reservation IS still in the QR feed — we just failed to process
      // it this run. Keep its existing appointment (if any) in the seen set so
      // the cancellation pass below does NOT mistake it for an orphan and mark
      // a live booking CANCELLED. Best-effort: if even this lookup fails, the
      // next sync re-evaluates.
      try {
        const stillThere = await findAppointmentByQrId(businessId, r.qrReservationId)
        if (stillThere) seenAppointmentIds.push(stillThere.id)
      } catch {
        // Couldn't even confirm this errored record's appointment — the
        // seen-set is now incomplete, so the orphan-cancellation pass can no
        // longer be trusted for this run.
        cancellationSafe = false
      }
      continue
    }
  }

  // --- Cancellation detection: find QR appointments in the window that we
  //     have locally but that DIDN'T come back from QR → mark cancelled.
  //     Skipped entirely when the seen-set can't be trusted (systemic fault),
  //     so a failed run never cancels live bookings — next sync re-evaluates. ---
  if (cancellationSafe) {
    cancelled = await markOrphanedCancelled(
      businessId,
      windowStart,
      windowEnd,
      seenAppointmentIds,
    )
  } else {
    cancelled = 0
    console.warn(
      `[sync] orphan-cancellation SKIPPED for business ${businessId}: a per-record lookup failed, seen-set may be incomplete (${skippedError} record(s) errored).`,
    )
  }

  return {
    date_window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    total_fetched: totalFetched,
    created,
    updated,
    cancelled,
    skipped_no_staff: skippedNoStaff,
    skipped_deleted: skippedDeleted,
    skipped_error: skippedError,
    unmatched_staff: Array.from(unmatchedStaff),
    duration_ms: 0, // filled by caller
  }
}

// =============================================================================
// Helpers
// =============================================================================

function matchStaff(
  qrStaffName: string,
  tenantStaff: Array<{ id: string; name: string; nameKana: string | null }>,
): string | null {
  // 1. Exact match
  const exact = tenantStaff.find((s) => s.name === qrStaffName || s.nameKana === qrStaffName)
  if (exact) return exact.id

  // 2. Substring (either direction)
  const substring = tenantStaff.find(
    (s) =>
      s.name.includes(qrStaffName) ||
      qrStaffName.includes(s.name) ||
      (s.nameKana && (s.nameKana.includes(qrStaffName) || qrStaffName.includes(s.nameKana))),
  )
  return substring?.id ?? null
}

// True when `e` is a Prisma P2002 unique-constraint violation whose target
// includes `field`. meta.target is either an array of field names or the
// constraint-name string, so we match against the stringified form.
function isUniqueViolation(e: unknown, field: string): boolean {
  if (e === null || typeof e !== 'object' || !('code' in e)) return false
  if ((e as { code?: unknown }).code !== 'P2002') return false
  const target = (e as { meta?: { target?: unknown } }).meta?.target
  const asStr = Array.isArray(target) ? target.join(',') : String(target ?? '')
  return asStr.includes(field)
}

async function findOrCreateCustomer(
  businessId: string,
  r: MappedQRReservation,
): Promise<string> {
  // Match an existing customer before creating one — order from most reliable
  // to least: stored QR id → phone → email → name. Every match runs through
  // reconcileExisting (backfills the QR id + fills ONLY empty profile fields),
  // so we never create duplicates and never overwrite richer existing data.
  const select = {
    id: true,
    phone: true,
    email: true,
    furigana: true,
    externalRefs: true,
  } as const

  // 1. Stored QuickReserve id — exact, written on a prior sync. Most reliable.
  const byQrId = await prisma.customer.findFirst({
    where: {
      businessId,
      externalRefs: { path: ['quickreserve', 'customerId'], equals: r.qrCustomerId },
    },
    select,
  })
  if (byQrId) return reconcileExisting(byQrId, r)

  // 2. Phone — the real personal identifier (携帯). It is NOT a DB-unique key,
  //    so only trust it when it points to EXACTLY ONE customer; 0 or >1 (e.g.
  //    a shared/placeholder number) is ambiguous → fall through.
  if (r.customerPhone) {
    const byPhone = await prisma.customer.findMany({
      where: { businessId, phone: r.customerPhone },
      select,
      take: 2,
    })
    if (byPhone.length === 1) {
      // Identity-conflict guard: if a present email points at a DIFFERENT
      // customer, don't silently fuse two people — log for review and proceed
      // with phone (phone-first policy).
      if (r.customerEmail) {
        const byEmail = await prisma.customer.findFirst({
          where: { businessId, email: r.customerEmail },
          select: { id: true },
        })
        if (byEmail && byEmail.id !== byPhone[0].id) {
          console.warn(
            `[sync] identity conflict for QR customer ${r.qrCustomerId}: ` +
              `phone→${byPhone[0].id} email→${byEmail.id}. Using phone; please review.`,
          )
        }
      }
      return reconcileExisting(byPhone[0], r)
    }
  }

  // 3. Email — DB-unique (businessId, email), so a match is exactly one
  //    customer. Catches records that have no phone.
  if (r.customerEmail) {
    const byEmail = await prisma.customer.findFirst({
      where: { businessId, email: r.customerEmail },
      select,
    })
    if (byEmail) return reconcileExisting(byEmail, r)
  }

  // 4. Name — last resort (names drift / collide), but still beats creating a
  //    duplicate.
  const byName = await prisma.customer.findFirst({
    where: { businessId, name: r.customerName },
    select,
  })
  if (byName) return reconcileExisting(byName, r)

  // 5. Create new — guarded against the (businessId, email) unique race: a
  // concurrent sync, or the same email twice in one batch, can insert between
  // the checks above and this create. On P2002 the row now exists, so
  // re-resolve by email instead of crashing — the sync stays idempotent.
  // nextKaruteNumber is max+1, so two concurrent syncs can race on
  // (businessId, karuteNumber); the email may also already exist. Resolve each
  // by the VIOLATED constraint (P2002 meta.target), never by guessing:
  //   - karuteNumber race  → someone took our number; recompute and retry.
  //   - email already taken → re-resolve to that customer and backfill the QR
  //     id onto them (so step 1 hits next sync), rather than returning a row
  //     that merely happens to share the email.
  const { nextKaruteNumber } = await import('./customer.service.js')
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await prisma.customer.create({
        data: {
          businessId,
          karuteNumber: await nextKaruteNumber(businessId),
          name: r.customerName,
          furigana: r.customerKana || null,
          phone: r.customerPhone || null,
          email: r.customerEmail || null,
          notes: r.customerNotes || null,
          externalRefs: { quickreserve: { customerId: r.qrCustomerId } },
        },
        select: { id: true },
      })
      return created.id
    } catch (e) {
      if (isUniqueViolation(e, 'karuteNumber') && attempt < 4) continue
      if (r.customerEmail && isUniqueViolation(e, 'email')) {
        const raced = await prisma.customer.findFirst({
          where: { businessId, email: r.customerEmail },
          select,
        })
        if (raced) return reconcileExisting(raced, r)
      }
      throw e
    }
  }
  throw new Error('findOrCreateCustomer: exhausted karuteNumber retries')
}

// Attach the QuickReserve id + fill ONLY empty profile fields from the QR
// record onto an already-matched customer. Never overwrites an existing
// value, and never touches name, notes, karute, or payment data.
async function reconcileExisting(
  existing: {
    id: string
    phone: string | null
    email: string | null
    furigana: string | null
    externalRefs: unknown
  },
  r: MappedQRReservation,
): Promise<string> {
  const refs = (existing.externalRefs as Record<string, unknown> | null) ?? {}
  const safe = {
    externalRefs: { ...refs, quickreserve: { customerId: r.qrCustomerId } },
    ...(!existing.phone && r.customerPhone ? { phone: r.customerPhone } : {}),
    ...(!existing.furigana && r.customerKana ? { furigana: r.customerKana } : {}),
  }
  // Email is the one backfilled field under a unique constraint: when we
  // matched on phone or name, r.customerEmail can already belong to a
  // DIFFERENT customer (the phone→A / email→B conflict). Try with the email,
  // and on a unique violation retry without it — never steal another
  // customer's address, and never crash.
  const wantEmail = !existing.email && !!r.customerEmail
  try {
    await prisma.customer.update({
      where: { id: existing.id },
      data: { ...safe, ...(wantEmail ? { email: r.customerEmail } : {}) },
    })
  } catch (e) {
    if (wantEmail && isUniqueViolation(e, 'email')) {
      await prisma.customer.update({ where: { id: existing.id }, data: safe })
    } else throw e
  }
  return existing.id
}

async function findAppointmentByQrId(
  businessId: string,
  qrReservationId: number,
): Promise<{ id: string } | null> {
  return prisma.appointment.findFirst({
    where: {
      businessId,
      source: 'QUICKRESERVE' as AppointmentSource,
      externalRefs: { path: ['quickreserve', 'reservationId'], equals: qrReservationId },
    },
    select: { id: true },
  })
}

async function markOrphanedCancelled(
  businessId: string,
  windowStart: Date,
  windowEnd: Date,
  seenIds: string[],
): Promise<number> {
  const result = await prisma.appointment.updateMany({
    where: {
      businessId,
      source: 'QUICKRESERVE' as AppointmentSource,
      startsAt: { gte: windowStart, lt: windowEnd },
      cancelledAt: null,
      status: { not: 'CANCELLED' as AppointmentStatus },
      id: { notIn: seenIds },
    },
    data: {
      status: 'CANCELLED' as AppointmentStatus,
      cancelledAt: new Date(),
    },
  })
  return result.count
}

function buildDateWindow(
  now: Date,
  lookaheadDays: number,
  timezone: string,
): { dateStrings: string[]; windowStart: Date; windowEnd: Date } {
  // Date strings in provider-local timezone (QR is JST)
  const dateStrings: string[] = []
  for (let i = 0; i <= lookaheadDays; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60_000)
    dateStrings.push(formatDateInTimezone(d, timezone))
  }

  const start = new Date(`${dateStrings[0]}T00:00:00+09:00`)
  const end = new Date(`${dateStrings[dateStrings.length - 1]}T23:59:59+09:00`)
  return { dateStrings, windowStart: start, windowEnd: end }
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(date) // YYYY-MM-DD
}

function buildNotes(r: MappedQRReservation): string {
  const parts: string[] = [`QR #${r.qrReservationId}`]
  if (r.customerNotes) parts.push(r.customerNotes.slice(0, 200))
  return parts.join(' | ')
}
