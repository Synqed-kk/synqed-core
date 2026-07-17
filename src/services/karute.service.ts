import { randomUUID } from 'node:crypto'
import { prisma } from '../db/client.js'
import { isUniqueViolation } from '../db/prisma-errors.js'
import type { KaruteStatus, EntryCategory, EntryAuthor, EntryEditAction, Prisma } from '@prisma/client'
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
  is_manual: boolean
  author: EntryAuthor
  original_ai_content: string | null
  version: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface KaruteRecordPublic {
  id: string
  business_id: string
  customer_id: string | null
  store_id: string | null
  staff_id: string
  appointment_id: string | null
  recording_session_id: string | null
  status: KaruteStatus
  ai_summary: string | null
  /** Human overlay (the pencil). Readers use edited_summary ?? ai_summary;
   *  regen keeps writing ai_summary and never touches this. */
  edited_summary: string | null
  transcript: string | null
  service: string | null
  duration_minutes: number | null
  session_date: string | null
  created_at: string
  updated_at: string
  entries?: EntryPublic[]
}

function toPublic(
  row: {
    id: string
    businessId: string
    customerId: string | null
    storeId: string | null
    staffId: string
    appointmentId: string | null
    recordingSessionId: string | null
    status: KaruteStatus
    aiSummary: string | null
    editedSummary: string | null
    transcript: string | null
    service: string | null
    durationMinutes: number | null
    sessionDate: Date | null
    createdAt: Date
    updatedAt: Date
  },
  entries?: EntryPublic[],
): KaruteRecordPublic {
  return {
    id: row.id,
    business_id: row.businessId,
    customer_id: row.customerId,
    store_id: row.storeId,
    staff_id: row.staffId,
    appointment_id: row.appointmentId,
    recording_session_id: row.recordingSessionId,
    status: row.status,
    ai_summary: row.aiSummary,
    edited_summary: row.editedSummary,
    transcript: row.transcript,
    service: row.service,
    duration_minutes: row.durationMinutes,
    session_date: row.sessionDate ? row.sessionDate.toISOString().slice(0, 10) : null,
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
  isManual: boolean
  author: EntryAuthor
  originalAiContent: string | null
  version: number
  deletedAt: Date | null
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
    is_manual: row.isManual,
    author: row.author,
    original_ai_content: row.originalAiContent,
    version: row.version,
    deleted_at: row.deletedAt ? row.deletedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listKaruteRecords(
  businessId: string,
  options: {
    customer_id?: string
    store_id?: string
    staff_id?: string
    recording_session_id?: string
    appointment_id?: string
    status?: KaruteStatus
    from?: string
    to?: string
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

  const where: Record<string, unknown> = { businessId }
  if (options.customer_id) where.customerId = options.customer_id
  if (options.store_id) where.storeId = options.store_id
  if (options.staff_id) where.staffId = options.staff_id
  if (options.recording_session_id) where.recordingSessionId = options.recording_session_id
  if (options.appointment_id) where.appointmentId = options.appointment_id
  if (options.status) where.status = options.status
  if (options.from || options.to) {
    const createdAt: Record<string, Date> = {}
    if (options.from) createdAt.gte = new Date(options.from)
    if (options.to) createdAt.lte = new Date(options.to)
    where.createdAt = createdAt
  }

  const [rows, total] = await Promise.all([
    prisma.karuteRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: pageSize,
      include: { _count: { select: { entries: { where: { deletedAt: null } } } } },
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
  businessId: string,
  id: string,
  opts?: { includeEntries?: boolean; includeSegments?: boolean },
): Promise<KaruteRecordPublic | null> {
  const row = await prisma.karuteRecord.findFirst({
    where: { id, businessId },
    include: {
      entries: opts?.includeEntries ? { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } : false,
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
  businessId: string,
  recordingSessionId: string,
  opts?: { includeEntries?: boolean; includeSegments?: boolean },
): Promise<KaruteRecordPublic | null> {
  const row = await prisma.karuteRecord.findFirst({
    where: { recordingSessionId, businessId },
    select: { id: true },
  })
  if (!row) return null
  return getKaruteRecord(businessId, row.id, opts)
}

export async function createKaruteRecord(
  businessId: string,
  input: CreateKaruteRecordInput,
): Promise<KaruteRecordPublic> {
  try {
    return await createKaruteRecordInner(businessId, input)
  } catch (e) {
    // Idempotent retry: the client stamps a stable recording_session_id on each
    // save. The UNIQUE(recording_session_id) index turns a retried save into a
    // P2002 instead of a duplicate row — return the record already saved rather
    // than surfacing a 500. Match the target column explicitly (not just any
    // P2002) so a future second unique index on this table can't misroute here.
    if (
      input.recording_session_id &&
      isUniqueViolation(e, 'recording_session_id')
    ) {
      const existing = await getByRecordingSession(
        businessId,
        input.recording_session_id,
        { includeEntries: true },
      )
      if (existing) return existing
    }
    throw e
  }
}

async function createKaruteRecordInner(
  businessId: string,
  input: CreateKaruteRecordInput,
): Promise<KaruteRecordPublic> {
  const row = await prisma.karuteRecord.create({
    data: {
      businessId,
      customerId: input.customer_id ?? null,
      storeId: input.store_id ?? null,
      staffId: input.staff_id,
      appointmentId: input.appointment_id ?? null,
      recordingSessionId: input.recording_session_id ?? null,
      status: input.status ?? 'DRAFT',
      aiSummary: input.ai_summary ?? null,
      transcript: input.transcript ?? null,
      service: input.service ?? null,
      durationMinutes: input.duration_minutes ?? null,
      sessionDate: input.session_date ? new Date(input.session_date) : null,
      entries: input.entries
        ? {
            create: input.entries.map((e, i) => ({
              category: e.category,
              content: e.content,
              originalQuote: e.original_quote ?? null,
              confidence: e.confidence ?? 0,
              tags: e.tags ?? [],
              sortOrder: e.sort_order ?? i,
              isManual: e.is_manual ?? false,
              author: (e.is_manual ? 'HUMAN_CREATED' : 'AI') as EntryAuthor,
            })),
          }
        : undefined,
    },
    include: { entries: { orderBy: { sortOrder: 'asc' } } },
  })
  return toPublic(row, row.entries.map(entryToPublic))
}

export async function updateKaruteRecord(
  businessId: string,
  id: string,
  input: UpdateKaruteRecordInput,
): Promise<KaruteRecordPublic> {
  const existing = await prisma.karuteRecord.findFirst({
    where: { id, businessId },
    include: { entries: { where: { deletedAt: null } } },
  })
  if (!existing) throw new Error('Karute record not found')

  const data: Record<string, unknown> = {}
  if (input.customer_id !== undefined) data.customerId = input.customer_id
  if (input.appointment_id !== undefined) data.appointmentId = input.appointment_id
  if (input.status !== undefined) data.status = input.status
  if (input.ai_summary !== undefined) data.aiSummary = input.ai_summary
  // Human overlay — only the pencil writes it (AI regen paths send ai_summary).
  if (input.edited_summary !== undefined) data.editedSummary = input.edited_summary
  if (input.transcript !== undefined) data.transcript = input.transcript
  if (input.service !== undefined) data.service = input.service
  if (input.duration_minutes !== undefined) data.durationMinutes = input.duration_minutes
  if (input.session_date !== undefined)
    data.sessionDate = input.session_date ? new Date(input.session_date) : null
  if (input.actor_staff_id !== undefined) data.lastEditedByStaffId = input.actor_staff_id

  const auditRows: Prisma.KaruteEntryEditCreateManyInput[] = []
  let replaceBatchId: string | undefined

  // Summary overlay change → one audit row (entry ids null = record-level).
  if (
    input.edited_summary !== undefined &&
    input.edited_summary !== existing.editedSummary
  ) {
    auditRows.push({
      businessId,
      customerId: existing.customerId,
      karuteRecordId: id,
      actorStaffId: input.actor_staff_id ?? null,
      action: 'EDIT',
      contentBefore: existing.editedSummary ?? existing.aiSummary,
      contentAfter: input.edited_summary,
    })
  }

  if (input.entries !== undefined) {
    // Full replace of entries (atomic — nested write shares the update's
    // transaction). One regen = ONE batch: every removed row logs its before-
    // content and every created row its after-content under a shared batch_id,
    // stamped with the prompt/model that produced it.
    const batchId = randomUUID()
    for (const old of existing.entries) {
      auditRows.push({
        businessId,
        customerId: existing.customerId,
        karuteRecordId: id,
        entryIdOld: old.id,
        actorStaffId: input.actor_staff_id ?? null,
        action: 'REGEN_REPLACE',
        category: old.category,
        contentBefore: old.content,
        authorBefore: old.author,
        batchId,
        promptVersion: input.prompt_version ?? null,
        model: input.model ?? null,
      })
    }
    await prisma.karuteEntry.deleteMany({ where: { karuteRecordId: id } })
    data.entries = {
      create: input.entries.map((e, i) => ({
        category: e.category,
        content: e.content,
        originalQuote: e.original_quote ?? null,
        confidence: e.confidence ?? 0,
        tags: e.tags ?? [],
        sortOrder: e.sort_order ?? i,
        isManual: e.is_manual ?? false,
        author: (e.is_manual ? 'HUMAN_CREATED' : 'AI') as EntryAuthor,
      })),
    }
    // New rows get their audit lines after the update (ids exist then).
    replaceBatchId = batchId
  }

  const row = await prisma.karuteRecord.update({
    where: { id },
    data,
    include: { entries: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
  })

  if (replaceBatchId !== undefined) {
    for (const created of row.entries) {
      auditRows.push({
        businessId,
        customerId: row.customerId,
        karuteRecordId: id,
        entryIdNew: created.id,
        actorStaffId: input.actor_staff_id ?? null,
        action: 'REGEN_REPLACE',
        category: created.category,
        contentAfter: created.content,
        authorAfter: created.author,
        batchId: replaceBatchId,
        promptVersion: input.prompt_version ?? null,
        model: input.model ?? null,
      })
    }
  }
  if (auditRows.length > 0) {
    await prisma.karuteEntryEdit.createMany({ data: auditRows })
  }

  return toPublic(row, row.entries.map(entryToPublic))
}

export async function deleteKaruteRecord(businessId: string, id: string): Promise<void> {
  const existing = await prisma.karuteRecord.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Karute record not found')
  await prisma.karuteRecord.delete({ where: { id } })
}

/** Optimistic-concurrency failure — routes map it to 409. */
export class StaleEntryVersionError extends Error {
  currentVersion: number
  constructor(currentVersion: number) {
    super('Entry was modified by someone else. Reload and retry.')
    this.name = 'StaleEntryVersionError'
    this.currentVersion = currentVersion
  }
}

/** Who did it + what produced it — threaded into the audit row. */
export interface EntryMutationMeta {
  actor_staff_id?: string | null
  /** Audit action override for the adopt/dismiss flows. */
  action?: EntryEditAction
  prompt_version?: string | null
  model?: string | null
}

/** Entry edits are child-table writes — bump the parent so updated_at is a
 *  usable anchor for edit-vs-regen and edit-vs-edit races, and record who. */
function touchParent(
  tx: Prisma.TransactionClient,
  karuteRecordId: string,
  actorStaffId?: string | null,
) {
  return tx.karuteRecord.update({
    where: { id: karuteRecordId },
    data: {
      updatedAt: new Date(),
      ...(actorStaffId ? { lastEditedByStaffId: actorStaffId } : {}),
    },
    select: { id: true },
  })
}

export async function addEntry(
  businessId: string,
  karuteRecordId: string,
  input: EntryInput,
  meta: EntryMutationMeta = {},
): Promise<EntryPublic> {
  // Verify karute record belongs to tenant
  const record = await prisma.karuteRecord.findFirst({
    where: { id: karuteRecordId, businessId },
    select: { id: true, customerId: true },
  })
  if (!record) throw new Error('Karute record not found')

  // Determine next sort order (live rows only)
  const lastEntry = await prisma.karuteEntry.findFirst({
    where: { karuteRecordId, deletedAt: null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  const nextSortOrder = (lastEntry?.sortOrder ?? -1) + 1

  return prisma.$transaction(async (tx) => {
    const row = await tx.karuteEntry.create({
      data: {
        karuteRecordId,
        category: input.category,
        content: input.content,
        originalQuote: input.original_quote ?? null,
        confidence: input.confidence ?? 0,
        tags: input.tags ?? [],
        sortOrder: input.sort_order ?? nextSortOrder,
        isManual: input.is_manual ?? false,
        author: (input.is_manual ? 'HUMAN_CREATED' : 'AI') as EntryAuthor,
      },
    })
    await tx.karuteEntryEdit.create({
      data: {
        businessId,
        customerId: record.customerId,
        karuteRecordId,
        entryIdNew: row.id,
        actorStaffId: meta.actor_staff_id ?? null,
        action: meta.action ?? 'CREATE',
        category: row.category,
        contentAfter: row.content,
        authorAfter: row.author,
        promptVersion: meta.prompt_version ?? null,
        model: meta.model ?? null,
      },
    })
    await touchParent(tx, karuteRecordId, meta.actor_staff_id)
    return entryToPublic(row)
  })
}

export interface UpdateEntryPatch {
  category?: EntryCategory
  content?: string
  original_quote?: string | null
  tags?: string[]
  sort_order?: number
  /** REQUIRED optimistic-concurrency check: the version the editor loaded.
   *  A mismatch throws StaleEntryVersionError (route → 409). */
  expected_version: number
}

export async function updateEntry(
  businessId: string,
  karuteRecordId: string,
  entryId: string,
  patch: UpdateEntryPatch,
  meta: EntryMutationMeta = {},
): Promise<EntryPublic> {
  const record = await prisma.karuteRecord.findFirst({
    where: { id: karuteRecordId, businessId },
    select: { id: true, customerId: true },
  })
  if (!record) throw new Error('Karute record not found')

  const entry = await prisma.karuteEntry.findFirst({
    where: { id: entryId, karuteRecordId, deletedAt: null },
  })
  if (!entry) throw new Error('Entry not found')
  if (entry.version !== patch.expected_version) {
    throw new StaleEntryVersionError(entry.version)
  }

  const contentChanging =
    patch.content !== undefined && patch.content !== entry.content
  const categoryChanging =
    patch.category !== undefined && patch.category !== entry.category
  const substantive = contentChanging || categoryChanging

  // AI → HUMAN_EDITED is one-way; the AI's original text is captured on the
  // FIRST substantive edit and never overwritten after.
  const nextAuthor: EntryAuthor =
    substantive && entry.author === 'AI' ? 'HUMAN_EDITED' : entry.author
  const captureOriginal =
    substantive && entry.author === 'AI' && entry.originalAiContent === null

  return prisma.$transaction(async (tx) => {
    // version guard in the WHERE clause too — closes the read-check/write race.
    const updated = await tx.karuteEntry.updateMany({
      where: { id: entryId, version: patch.expected_version },
      data: {
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.original_quote !== undefined ? { originalQuote: patch.original_quote } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.sort_order !== undefined ? { sortOrder: patch.sort_order } : {}),
        author: nextAuthor,
        ...(captureOriginal ? { originalAiContent: entry.content } : {}),
        version: { increment: 1 },
      },
    })
    if (updated.count === 0) throw new StaleEntryVersionError(entry.version)

    await tx.karuteEntryEdit.create({
      data: {
        businessId,
        customerId: record.customerId,
        karuteRecordId,
        entryIdOld: entryId,
        entryIdNew: entryId,
        actorStaffId: meta.actor_staff_id ?? null,
        action: meta.action ?? 'EDIT',
        category: patch.category ?? entry.category,
        contentBefore: entry.content,
        contentAfter: patch.content ?? entry.content,
        authorBefore: entry.author,
        authorAfter: nextAuthor,
        promptVersion: meta.prompt_version ?? null,
        model: meta.model ?? null,
      },
    })
    await touchParent(tx, karuteRecordId, meta.actor_staff_id)

    const row = await tx.karuteEntry.findUniqueOrThrow({ where: { id: entryId } })
    return entryToPublic(row)
  })
}

export async function deleteEntry(
  businessId: string,
  karuteRecordId: string,
  entryId: string,
  meta: EntryMutationMeta = {},
): Promise<void> {
  // Verify karute record belongs to tenant (enforces tenant isolation for entry)
  const record = await prisma.karuteRecord.findFirst({
    where: { id: karuteRecordId, businessId },
    select: { id: true, customerId: true },
  })
  if (!record) throw new Error('Karute record not found')

  const entry = await prisma.karuteEntry.findFirst({
    where: { id: entryId, karuteRecordId, deletedAt: null },
  })
  if (!entry) throw new Error('Entry not found')

  // Soft delete: hidden from every read, never vanishes (customer-memory
  // pattern) — the audit row carries what was removed and by whom.
  await prisma.$transaction(async (tx) => {
    await tx.karuteEntry.update({
      where: { id: entryId },
      data: { deletedAt: new Date() },
    })
    await tx.karuteEntryEdit.create({
      data: {
        businessId,
        customerId: record.customerId,
        karuteRecordId,
        entryIdOld: entryId,
        actorStaffId: meta.actor_staff_id ?? null,
        action: meta.action ?? 'DELETE',
        category: entry.category,
        contentBefore: entry.content,
        authorBefore: entry.author,
        promptVersion: meta.prompt_version ?? null,
        model: meta.model ?? null,
      },
    })
    await touchParent(tx, karuteRecordId, meta.actor_staff_id)
  })
}

export interface EntryEditPublic {
  id: string
  business_id: string
  customer_id: string | null
  karute_record_id: string
  entry_id_old: string | null
  entry_id_new: string | null
  actor_staff_id: string | null
  action: EntryEditAction
  category: EntryCategory | null
  content_before: string | null
  content_after: string | null
  author_before: EntryAuthor | null
  author_after: EntryAuthor | null
  batch_id: string | null
  prompt_version: string | null
  model: string | null
  created_at: string
}

/** The 監査ログ read: newest first, filterable by record/customer. */
export async function listEntryEdits(
  businessId: string,
  options: {
    karute_record_id?: string
    customer_id?: string
    page?: number
    page_size?: number
  } = {},
): Promise<{ entry_edits: EntryEditPublic[]; total: number; page: number; page_size: number }> {
  const page = options.page ?? 1
  const pageSize = Math.min(options.page_size ?? 50, 200)
  const where: Record<string, unknown> = { businessId }
  if (options.karute_record_id) where.karuteRecordId = options.karute_record_id
  if (options.customer_id) where.customerId = options.customer_id

  const [rows, total] = await Promise.all([
    prisma.karuteEntryEdit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.karuteEntryEdit.count({ where }),
  ])

  return {
    entry_edits: rows.map((r) => ({
      id: r.id,
      business_id: r.businessId,
      customer_id: r.customerId,
      karute_record_id: r.karuteRecordId,
      entry_id_old: r.entryIdOld,
      entry_id_new: r.entryIdNew,
      actor_staff_id: r.actorStaffId,
      action: r.action,
      category: r.category,
      content_before: r.contentBefore,
      content_after: r.contentAfter,
      author_before: r.authorBefore,
      author_after: r.authorAfter,
      batch_id: r.batchId,
      prompt_version: r.promptVersion,
      model: r.model,
      created_at: r.createdAt.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  }
}
