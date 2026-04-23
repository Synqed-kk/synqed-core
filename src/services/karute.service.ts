import { prisma } from '../db/client.js'
import type { KaruteStatus, EntryCategory } from '@prisma/client'
import type {
  CreateKaruteRecordInput,
  UpdateKaruteRecordInput,
  EntryInput,
} from '../validations/karute.js'

export interface EntryPublic {
  id: string
  karute_record_id: string
  category: EntryCategory
  content: string
  original_quote: string | null
  confidence: number
  tags: string[]
  sort_order: number
  created_at: string
  updated_at: string
}

export interface KaruteRecordPublic {
  id: string
  tenant_id: string
  customer_id: string | null
  staff_id: string
  appointment_id: string | null
  recording_session_id: string | null
  status: KaruteStatus
  ai_summary: string | null
  created_at: string
  updated_at: string
  entries?: EntryPublic[]
}

function toPublic(
  row: {
    id: string
    tenantId: string
    customerId: string | null
    staffId: string
    appointmentId: string | null
    recordingSessionId: string | null
    status: KaruteStatus
    aiSummary: string | null
    createdAt: Date
    updatedAt: Date
  },
  entries?: EntryPublic[],
): KaruteRecordPublic {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    customer_id: row.customerId,
    staff_id: row.staffId,
    appointment_id: row.appointmentId,
    recording_session_id: row.recordingSessionId,
    status: row.status,
    ai_summary: row.aiSummary,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(entries !== undefined ? { entries } : {}),
  }
}

function entryToPublic(row: {
  id: string
  karuteRecordId: string
  category: EntryCategory
  content: string
  originalQuote: string | null
  confidence: number
  tags: string[]
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}): EntryPublic {
  return {
    id: row.id,
    karute_record_id: row.karuteRecordId,
    category: row.category,
    content: row.content,
    original_quote: row.originalQuote,
    confidence: row.confidence,
    tags: row.tags,
    sort_order: row.sortOrder,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listKaruteRecords(
  tenantId: string,
  options: {
    customer_id?: string
    staff_id?: string
    recording_session_id?: string
    status?: KaruteStatus
    page?: number
    page_size?: number
  },
): Promise<{
  karute_records: KaruteRecordPublic[]
  total: number
  page: number
  page_size: number
}> {
  const page = options.page ?? 1
  const pageSize = options.page_size ?? 100
  const offset = (page - 1) * pageSize

  const where: Record<string, unknown> = { tenantId }
  if (options.customer_id) where.customerId = options.customer_id
  if (options.staff_id) where.staffId = options.staff_id
  if (options.recording_session_id) where.recordingSessionId = options.recording_session_id
  if (options.status) where.status = options.status

  const [rows, total] = await Promise.all([
    prisma.karuteRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: pageSize,
      include: { _count: { select: { entries: true } } },
    }),
    prisma.karuteRecord.count({ where }),
  ])

  return {
    karute_records: rows.map((r) => ({ ...toPublic(r), entry_count: r._count.entries })),
    total,
    page,
    page_size: pageSize,
  }
}

export async function getKaruteRecord(
  tenantId: string,
  id: string,
  opts?: { includeEntries?: boolean; includeSegments?: boolean },
): Promise<KaruteRecordPublic | null> {
  const row = await prisma.karuteRecord.findFirst({
    where: { id, tenantId },
    include: {
      entries: opts?.includeEntries ? { orderBy: { sortOrder: 'asc' } } : false,
      recordingSession: opts?.includeSegments
        ? { include: { segments: { orderBy: { segmentIndex: 'asc' } } } }
        : false,
    },
  })
  if (!row) return null

  const entries = opts?.includeEntries && row.entries ? row.entries.map(entryToPublic) : undefined
  const out: KaruteRecordPublic & { recording_session?: unknown } = toPublic(row, entries)
  if (opts?.includeSegments && row.recordingSession) {
    const rs = row.recordingSession as unknown as {
      id: string
      segments: Array<{
        id: string
        segmentIndex: number
        text: string
        startTime: number
        endTime: number
        speakerLabel: string | null
        confidence: number | null
      }>
    }
    out.recording_session = {
      id: rs.id,
      segments: rs.segments.map((s) => ({
        id: s.id,
        segment_index: s.segmentIndex,
        text: s.text,
        start_time: s.startTime,
        end_time: s.endTime,
        speaker_label: s.speakerLabel,
        confidence: s.confidence,
      })),
    }
  }
  return out
}

export async function getByRecordingSession(
  tenantId: string,
  recordingSessionId: string,
  opts?: { includeEntries?: boolean; includeSegments?: boolean },
): Promise<KaruteRecordPublic | null> {
  const row = await prisma.karuteRecord.findFirst({
    where: { recordingSessionId, tenantId },
    select: { id: true },
  })
  if (!row) return null
  return getKaruteRecord(tenantId, row.id, opts)
}

export async function createKaruteRecord(
  tenantId: string,
  input: CreateKaruteRecordInput,
): Promise<KaruteRecordPublic> {
  const row = await prisma.karuteRecord.create({
    data: {
      tenantId,
      customerId: input.customer_id ?? null,
      staffId: input.staff_id,
      appointmentId: input.appointment_id ?? null,
      recordingSessionId: input.recording_session_id ?? null,
      status: input.status ?? 'DRAFT',
      aiSummary: input.ai_summary ?? null,
      entries: input.entries
        ? {
            create: input.entries.map((e, i) => ({
              category: e.category,
              content: e.content,
              originalQuote: e.original_quote ?? null,
              confidence: e.confidence ?? 0,
              tags: e.tags ?? [],
              sortOrder: e.sort_order ?? i,
            })),
          }
        : undefined,
    },
    include: { entries: { orderBy: { sortOrder: 'asc' } } },
  })
  return toPublic(row, row.entries.map(entryToPublic))
}

export async function updateKaruteRecord(
  tenantId: string,
  id: string,
  input: UpdateKaruteRecordInput,
): Promise<KaruteRecordPublic> {
  const existing = await prisma.karuteRecord.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error('Karute record not found')

  const data: Record<string, unknown> = {}
  if (input.customer_id !== undefined) data.customerId = input.customer_id
  if (input.status !== undefined) data.status = input.status
  if (input.ai_summary !== undefined) data.aiSummary = input.ai_summary

  if (input.entries !== undefined) {
    // Full replace of entries
    await prisma.karuteEntry.deleteMany({ where: { karuteRecordId: id } })
    data.entries = {
      create: input.entries.map((e, i) => ({
        category: e.category,
        content: e.content,
        originalQuote: e.original_quote ?? null,
        confidence: e.confidence ?? 0,
        tags: e.tags ?? [],
        sortOrder: e.sort_order ?? i,
      })),
    }
  }

  const row = await prisma.karuteRecord.update({
    where: { id },
    data,
    include: { entries: { orderBy: { sortOrder: 'asc' } } },
  })
  return toPublic(row, row.entries.map(entryToPublic))
}

export async function deleteKaruteRecord(tenantId: string, id: string): Promise<void> {
  const existing = await prisma.karuteRecord.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error('Karute record not found')
  await prisma.karuteRecord.delete({ where: { id } })
}
