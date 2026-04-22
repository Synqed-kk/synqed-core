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
  tenant_id: string
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
  tenantId: string
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
    tenant_id: row.tenantId,
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
  tenantId: string,
  provider: SyncProvider,
): Promise<SyncConfigPublic | null> {
  const row = await prisma.syncConfig.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
  })
  return row ? toPublic(row) : null
}

export async function upsertConfig(
  tenantId: string,
  provider: SyncProvider,
  input: SyncConfigInput,
): Promise<SyncConfigPublic> {
  // If password is provided, encrypt the full credential envelope.
  // Otherwise leave existing ciphertext untouched.
  let credentialsEncrypted: Uint8Array<ArrayBuffer> | undefined
  if (input.password !== undefined) {
    if (provider === 'QUICKRESERVE') {
      const existing = await prisma.syncConfig.findUnique({
        where: { tenantId_provider: { tenantId, provider } },
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
    where: { tenantId_provider: { tenantId, provider } },
    create: {
      tenantId,
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
      await runSyncForTenant(config.tenantId, config.provider)
      dispatched++
    } catch (err) {
      console.error(`[cron] sync failed for ${config.tenantId}/${config.provider}`, err)
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
  tenantId: string,
  provider: SyncProvider,
): Promise<SyncRunResult> {
  const config = await prisma.syncConfig.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
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
      result = await runQuickReserveSync(tenantId, config, creds)
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
  tenantId: string
  storeSlug: string | null
  storeId: number | null
  lookaheadDays: number
  timezone: string
}

async function runQuickReserveSync(
  tenantId: string,
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
    where: { tenantId, isActive: true },
    select: { id: true, name: true, nameKana: true },
  })

  let created = 0
  let updated = 0
  let cancelled = 0
  let skippedNoStaff = 0
  let skippedDeleted = 0
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

    // --- Customer find-or-create by QR id → fall back to (tenant, name) ---
    const customerId = await findOrCreateCustomer(tenantId, r)

    // --- Appointment upsert by externalRefs.quickreserve.reservationId ---
    const existing = await findAppointmentByQrId(tenantId, r.qrReservationId)
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
          tenantId,
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
  }

  // --- Cancellation detection: find QR appointments in the window that we
  //     have locally but that DIDN'T come back from QR → mark cancelled ---
  cancelled = await markOrphanedCancelled(
    tenantId,
    windowStart,
    windowEnd,
    seenAppointmentIds,
  )

  return {
    date_window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    total_fetched: totalFetched,
    created,
    updated,
    cancelled,
    skipped_no_staff: skippedNoStaff,
    skipped_deleted: skippedDeleted,
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

async function findOrCreateCustomer(
  tenantId: string,
  r: MappedQRReservation,
): Promise<string> {
  // 1. Try by externalRefs.quickreserve.customerId (most reliable)
  const byQrId = await prisma.customer.findFirst({
    where: {
      tenantId,
      externalRefs: { path: ['quickreserve', 'customerId'], equals: r.qrCustomerId },
    },
    select: { id: true },
  })
  if (byQrId) return byQrId.id

  // 2. Fall back to name match (best-effort — may create duplicates if names drift)
  const byName = await prisma.customer.findFirst({
    where: { tenantId, name: r.customerName },
    select: { id: true, externalRefs: true },
  })
  if (byName) {
    // Backfill the QR customer id so future matches are reliable
    const existingRefs = (byName.externalRefs as Record<string, unknown> | null) ?? {}
    await prisma.customer.update({
      where: { id: byName.id },
      data: {
        externalRefs: {
          ...existingRefs,
          quickreserve: { customerId: r.qrCustomerId },
        },
      },
    })
    return byName.id
  }

  // 3. Create new
  const created = await prisma.customer.create({
    data: {
      tenantId,
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
}

async function findAppointmentByQrId(
  tenantId: string,
  qrReservationId: number,
): Promise<{ id: string } | null> {
  return prisma.appointment.findFirst({
    where: {
      tenantId,
      source: 'QUICKRESERVE' as AppointmentSource,
      externalRefs: { path: ['quickreserve', 'reservationId'], equals: qrReservationId },
    },
    select: { id: true },
  })
}

async function markOrphanedCancelled(
  tenantId: string,
  windowStart: Date,
  windowEnd: Date,
  seenIds: string[],
): Promise<number> {
  const result = await prisma.appointment.updateMany({
    where: {
      tenantId,
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
