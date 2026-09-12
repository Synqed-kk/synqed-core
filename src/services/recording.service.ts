import { prisma } from '../db/client.js'
import type { RecordingStatus } from '@prisma/client'
import type {
  CreateRecordingInput,
  UpdateRecordingInput,
  SegmentInput,
} from '../validations/recording.js'
import type { ActorContext } from '../types/api.js'
import { isRecordNotFound, isUniqueViolation } from '../db/prisma-errors.js'

export class RecordingAudioConflictError extends Error {
  constructor() {
    super('Recording audio is already reserved and cannot be replaced or deleted.')
    this.name = 'RecordingAudioConflictError'
  }
}

export class RecordingForbiddenError extends Error {
  constructor() {
    super('Not permitted to update this recording.')
    this.name = 'RecordingForbiddenError'
  }
}

export class SegmentConflictError extends Error {
  constructor() {
    super('A segment with this recording_session_id and segment_index already exists.')
    this.name = 'SegmentConflictError'
  }
}

export interface SegmentPublic {
  id: string
  recording_session_id: string
  segment_index: number
  text: string
  start_time: number
  end_time: number
  speaker_label: string | null
  confidence: number | null
  created_at: string
}

export interface RecordingPublic {
  id: string
  business_id: string
  customer_id: string | null
  store_id: string | null
  staff_id: string
  appointment_id: string | null
  audio_storage_path: string | null
  shared_at: string | null
  shared_by_staff_id: string | null
  duration_seconds: number | null
  status: RecordingStatus
  created_at: string
  updated_at: string
}

function toPublic(row: {
  id: string
  businessId: string
  customerId: string | null
  storeId: string | null
  staffId: string
  appointmentId: string | null
  audioStoragePath: string | null
  sharedAt: Date | null
  sharedByStaffId: string | null
  durationSeconds: number | null
  status: RecordingStatus
  createdAt: Date
  updatedAt: Date
}): RecordingPublic {
  return {
    id: row.id,
    business_id: row.businessId,
    customer_id: row.customerId,
    store_id: row.storeId,
    staff_id: row.staffId,
    appointment_id: row.appointmentId,
    audio_storage_path: row.audioStoragePath,
    shared_at: row.sharedAt?.toISOString() ?? null,
    shared_by_staff_id: row.sharedByStaffId,
    duration_seconds: row.durationSeconds,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

function segmentToPublic(row: {
  id: string
  recordingSessionId: string
  segmentIndex: number
  text: string
  startTime: number
  endTime: number
  speakerLabel: string | null
  confidence: number | null
  createdAt: Date
}): SegmentPublic {
  return {
    id: row.id,
    recording_session_id: row.recordingSessionId,
    segment_index: row.segmentIndex,
    text: row.text,
    start_time: row.startTime,
    end_time: row.endTime,
    speaker_label: row.speakerLabel,
    confidence: row.confidence,
    created_at: row.createdAt.toISOString(),
  }
}

export async function listRecordings(
  businessId: string,
  options: {
    audio_storage_path?: string
    ids?: string[]
    from?: string
    to?: string
    date?: string
    customer_id?: string
    store_id?: string
    staff_id?: string
    status?: RecordingStatus
    page?: number
    page_size?: number
  },
): Promise<{
  recordings: RecordingPublic[]
  total: number
  page: number
  page_size: number
}> {
  const page = options.page ?? 1
  const pageSize = options.page_size ?? 100
  const offset = (page - 1) * pageSize

  const where: Record<string, unknown> = { businessId }
  if (options.audio_storage_path !== undefined) where.audioStoragePath = options.audio_storage_path

  // Match customers.list batch lookup semantics: a non-empty id set stays
  // tenant-scoped and returns the complete requested set without pagination.
  if (options.ids && options.ids.length > 0) {
    where.id = { in: options.ids }
    const rows = await prisma.recordingSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
    return {
      recordings: rows.map(toPublic),
      total: rows.length,
      page: 1,
      page_size: rows.length,
    }
  }

  if (options.customer_id) where.customerId = options.customer_id
  if (options.store_id) where.storeId = options.store_id
  if (options.staff_id) where.staffId = options.staff_id
  if (options.status) where.status = options.status

  let fromDate: Date | undefined
  let toDate: Date | undefined
  if (options.date) {
    fromDate = new Date(`${options.date}T00:00:00Z`)
    toDate = new Date(`${options.date}T23:59:59.999Z`)
  }
  if (options.from) fromDate = new Date(options.from)
  if (options.to) toDate = new Date(options.to)
  if (fromDate || toDate) {
    const range: Record<string, Date> = {}
    if (fromDate) range.gte = fromDate
    if (toDate) range.lte = toDate
    where.createdAt = range
  }

  const [rows, total] = await Promise.all([
    prisma.recordingSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: pageSize,
    }),
    prisma.recordingSession.count({ where }),
  ])

  return { recordings: rows.map(toPublic), total, page, page_size: pageSize }
}

export async function getRecording(
  businessId: string,
  id: string,
): Promise<RecordingPublic | null> {
  const row = await prisma.recordingSession.findFirst({ where: { id, businessId } })
  return row ? toPublic(row) : null
}

export async function createRecording(
  businessId: string,
  input: CreateRecordingInput,
): Promise<RecordingPublic> {
  const row = await prisma.recordingSession.create({
    data: {
      businessId,
      customerId: input.customer_id ?? null,
      storeId: input.store_id ?? null,
      staffId: input.staff_id,
      appointmentId: input.appointment_id ?? null,
      audioStoragePath: input.audio_storage_path ?? null,
      durationSeconds: input.duration_seconds ?? null,
      status: input.status ?? 'RECORDING',
      ...(input.created_at ? { createdAt: new Date(input.created_at) } : {}),
    },
  }).catch((err: unknown) => {
    if (isUniqueViolation(err, 'audio_storage_path')) throw new RecordingAudioConflictError()
    throw err
  })
  return toPublic(row)
}

export async function updateRecording(
  businessId: string,
  id: string,
  input: UpdateRecordingInput,
  actor: ActorContext,
): Promise<RecordingPublic> {
  const existing = await prisma.recordingSession.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Recording not found')

  const canWrite = actor.capabilities.includes('records.write')
  const canUpdateOtherStaff = actor.capabilities.includes('recordings.viewAll')
  // ⚖ ONE ROW, TWO ID SPACES. The Karute app stamps recording_sessions.staff_id
  // with the recorder's AUTH USER id (karute customer-facade.ts#resolveSelfStaffId
  // → session-mint.ts), while the answer sheet's staff_id is the staff ROW id
  // (permission.service.ts#answerSheet). Both name the same person, and "own
  // session" must hold in either — comparing the row id alone refused every
  // non-manager finalize in production (2026-09-08, PUT /v1/recordings/:id 403).
  const ownSession = existing.staffId === actor.staffId || existing.staffId === actor.userId
  if (!canWrite || (!ownSession && !canUpdateOtherStaff)) {
    throw new RecordingForbiddenError()
  }

  const data: Record<string, unknown> = {}
  if (input.shared_at !== undefined) data.sharedAt = input.shared_at === null ? null : new Date(input.shared_at)
  if (input.shared_by_staff_id !== undefined) data.sharedByStaffId = input.shared_by_staff_id
  if (input.customer_id !== undefined) data.customerId = input.customer_id
  if (input.audio_storage_path !== undefined) data.audioStoragePath = input.audio_storage_path
  if (input.duration_seconds !== undefined) data.durationSeconds = input.duration_seconds
  if (input.status !== undefined) data.status = input.status

  try {
    const row = await prisma.recordingSession.update({
      where: {
        id,
        businessId,
        // Test the current value in the write, so competing reservations
        // cannot both succeed after reading the same empty session.
        ...(input.audio_storage_path !== undefined ? {
          OR: [{ audioStoragePath: null }, { audioStoragePath: input.audio_storage_path }],
        } : {}),
      },
      data,
    })
    return toPublic(row)
  } catch (err) {
    if (isUniqueViolation(err, 'audio_storage_path')) throw new RecordingAudioConflictError()
    if (isRecordNotFound(err)) {
      const current = await prisma.recordingSession.findFirst({ where: { id, businessId } })
      if (!current) throw new Error('Recording not found')
      throw new RecordingAudioConflictError()
    }
    throw err
  }
}

export async function deleteRecording(businessId: string, id: string): Promise<void> {
  // A reservation that wins the race must prevent this delete too.
  const result = await prisma.recordingSession.deleteMany({
    where: { id, businessId, audioStoragePath: null },
  })
  if (result.count > 0) return
  const existing = await prisma.recordingSession.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Recording not found')
  throw new RecordingAudioConflictError()
}

export async function listSegments(
  businessId: string,
  recordingId: string,
): Promise<SegmentPublic[]> {
  const rec = await prisma.recordingSession.findFirst({
    where: { id: recordingId, businessId },
    select: { id: true },
  })
  if (!rec) throw new Error('Recording not found')

  const rows = await prisma.transcriptionSegment.findMany({
    where: { recordingSessionId: recordingId },
    orderBy: { segmentIndex: 'asc' },
  })
  return rows.map(segmentToPublic)
}

export async function upsertSegments(
  businessId: string,
  recordingId: string,
  segments: SegmentInput[],
  replace: boolean,
): Promise<SegmentPublic[]> {
  try {
    const rows = await prisma.$transaction(async (tx) => {
      // Lock the parent even when the transcript is empty. Every segment
      // writer shares this lock so concurrent replacements cannot interleave.
      const recordings = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM recording_sessions
        WHERE id = ${recordingId}::uuid AND business_id = ${businessId}::uuid
        FOR UPDATE
      `
      if (recordings.length === 0) throw new Error('Recording not found')

      if (replace) {
        await tx.transcriptionSegment.deleteMany({
          where: { recordingSessionId: recordingId },
        })
      }
      if (segments.length > 0) {
        await tx.transcriptionSegment.createMany({
          data: segments.map((s) => ({
            recordingSessionId: recordingId,
            segmentIndex: s.segment_index,
            text: s.text,
            startTime: s.start_time,
            endTime: s.end_time,
            speakerLabel: s.speaker_label ?? null,
            confidence: s.confidence ?? null,
          })),
        })
      }
      return tx.transcriptionSegment.findMany({
        where: { recordingSessionId: recordingId },
        orderBy: { segmentIndex: 'asc' },
      })
    })
    return rows.map(segmentToPublic)
  } catch (err) {
    if (isUniqueViolation(err, 'segment_index')) throw new SegmentConflictError()
    throw err
  }
}
