import { prisma } from '../db/client.js'
import type { RecordingDiscardSource } from '@prisma/client'

// One row per recording discard. The written reason is CONTENT — it lives on
// this row and never in the audit log; audit rows carry this row's id in
// detail instead. Staff discards are abnormal and REQUIRE a written
// explanation; system cleanup rows carry none (Liam 8/17 — the reason-category
// menu is gone, the category is exactly staff-vs-system).

export class InvalidDiscardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDiscardError'
  }
}

export interface DiscardEventPublic {
  id: string
  recording_session_id: string
  source: RecordingDiscardSource
  discarded_by: string | null
  reason: string | null
  created_at: string
}

function toPublic(r: {
  id: string
  recordingSessionId: string
  source: RecordingDiscardSource
  discardedBy: string | null
  reason: string | null
  createdAt: Date
}): DiscardEventPublic {
  return {
    id: r.id,
    recording_session_id: r.recordingSessionId,
    source: r.source,
    discarded_by: r.discardedBy,
    reason: r.reason,
    created_at: r.createdAt.toISOString(),
  }
}

export interface RecordDiscardInput {
  recording_session_id: string
  source: RecordingDiscardSource
  /** Staff card id or login uuid — required for STAFF, forbidden for SYSTEM. */
  discarded_by?: string | null
  /** Written explanation — required non-blank for STAFF, forbidden for SYSTEM. */
  reason?: string | null
}

export async function recordDiscardEvent(
  businessId: string,
  input: RecordDiscardInput,
): Promise<DiscardEventPublic> {
  if (input.source === 'STAFF') {
    if (!input.discarded_by) throw new InvalidDiscardError('discarded_by is required for a staff discard.')
    if (!input.reason || input.reason.trim() === '') {
      throw new InvalidDiscardError('A written reason is required for a staff discard.')
    }
  } else {
    if (input.discarded_by) throw new InvalidDiscardError('discarded_by must be empty for a system discard.')
    if (input.reason != null && input.reason !== '') {
      throw new InvalidDiscardError('reason must be empty for a system discard.')
    }
  }

  let discardedBy: string | null = null
  if (input.source === 'STAFF') {
    // Either identity form in (card id or login uuid), card id stored — house rule.
    const staff = await prisma.staff.findFirst({
      where: {
        businessId,
        OR: [{ id: input.discarded_by! }, { userId: input.discarded_by! }],
      },
      select: { id: true },
    })
    if (!staff) throw new InvalidDiscardError('Discarding staff not found in this business.')
    discardedBy = staff.id
  }

  const row = await prisma.recordingDiscardEvent.create({
    data: {
      businessId,
      recordingSessionId: input.recording_session_id,
      source: input.source,
      discardedBy,
      reason: input.source === 'STAFF' ? input.reason!.trim() : null,
    },
  })
  return toPublic(row)
}

export interface ListDiscardOptions {
  recording_session_id?: string
  source?: RecordingDiscardSource
  page?: number
  page_size?: number
}

export async function listDiscardEvents(
  businessId: string,
  options: ListDiscardOptions = {},
): Promise<{ events: DiscardEventPublic[]; total: number; page: number; page_size: number }> {
  const page = options.page ?? 1
  const pageSize = Math.min(options.page_size ?? 100, 500)
  const where: Record<string, unknown> = { businessId }
  if (options.recording_session_id) where.recordingSessionId = options.recording_session_id
  if (options.source) where.source = options.source
  const [rows, total] = await Promise.all([
    prisma.recordingDiscardEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.recordingDiscardEvent.count({ where }),
  ])
  return { events: rows.map(toPublic), total, page, page_size: pageSize }
}
