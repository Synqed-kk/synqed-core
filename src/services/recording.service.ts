import { prisma } from '../db/client.js'
import type { RecordingLifecycleState, RecordingStatus, Prisma } from '@prisma/client'
import type {
  CreateRecordingInput,
  UpdateRecordingInput,
  SegmentInput,
} from '../validations/recording.js'
import type { ActorContext } from '../types/api.js'
import { isUniqueViolation } from '../db/prisma-errors.js'

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
  duration_seconds: number | null
  status: RecordingStatus
  lifecycle_state: RecordingLifecycleState
  client_version: string | null
  platform: string | null
  audio_mime: string | null
  sample_rate_hz: number | null
  audio_route: string | null
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
  durationSeconds: number | null
  status: RecordingStatus
  lifecycleState: RecordingLifecycleState
  clientVersion: string | null
  platform: string | null
  audioMime: string | null
  sampleRateHz: number | null
  audioRoute: string | null
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
    duration_seconds: row.durationSeconds,
    status: row.status,
    lifecycle_state: row.lifecycleState,
    client_version: row.clientVersion,
    platform: row.platform,
    audio_mime: row.audioMime,
    sample_rate_hz: row.sampleRateHz,
    audio_route: row.audioRoute,
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
    ids?: string[]
    from?: string
    to?: string
    date?: string
    customer_id?: string
    store_id?: string
    staff_id?: string
    status?: RecordingStatus
    without_karute?: boolean
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
  if (options.without_karute) where.karuteRecord = null

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

/** Owner/manager read door for sessions that have not produced a karute. */
export async function listUnfinishedRecordings(
  businessId: string,
  options: { from?: string; to?: string; store_id?: string; page?: number; page_size?: number },
  visibleStoreIds: string[] | null,
): Promise<{ recordings: RecordingPublic[]; total: number; page: number; page_size: number }> {
  const page = options.page ?? 1
  const pageSize = options.page_size ?? 100
  const where: Prisma.RecordingSessionWhereInput = {
    businessId,
    lifecycleState: { notIn: ['SAVED', 'DISCARDED'] },
    karuteRecord: null,
  }
  if (options.store_id && visibleStoreIds !== null && !visibleStoreIds.includes(options.store_id)) {
    throw new RecordingForbiddenError()
  }
  if (options.store_id) where.storeId = options.store_id
  else if (visibleStoreIds) where.storeId = { in: visibleStoreIds }
  if (options.from || options.to) {
    where.createdAt = {
      ...(options.from ? { gte: new Date(options.from) } : {}),
      ...(options.to ? { lte: new Date(options.to) } : {}),
    }
  }
  const [rows, total] = await Promise.all([
    prisma.recordingSession.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.recordingSession.count({ where }),
  ])
  return { recordings: rows.map(toPublic), total, page, page_size: pageSize }
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
      lifecycleState:
        input.audio_storage_path && input.duration_seconds != null
          ? 'FINALIZED'
          : input.audio_storage_path
            ? 'UPLOADED'
            : 'RECORDING',
      clientVersion: input.client_version ?? null,
      platform: input.platform ?? null,
      audioMime: input.audio_mime ?? null,
      sampleRateHz: input.sample_rate_hz ?? null,
      audioRoute: input.audio_route ?? null,
      ...(input.created_at ? { createdAt: new Date(input.created_at) } : {}),
    },
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
  if (input.customer_id !== undefined) data.customerId = input.customer_id
  if (input.audio_storage_path !== undefined) data.audioStoragePath = input.audio_storage_path
  if (input.duration_seconds !== undefined) data.durationSeconds = input.duration_seconds
  if (input.status !== undefined) data.status = input.status
  if (input.client_version !== undefined) data.clientVersion = input.client_version
  if (input.platform !== undefined) data.platform = input.platform
  if (input.audio_mime !== undefined) data.audioMime = input.audio_mime
  if (input.sample_rate_hz !== undefined) data.sampleRateHz = input.sample_rate_hz
  if (input.audio_route !== undefined) data.audioRoute = input.audio_route
  if (input.audio_storage_path !== undefined && input.audio_storage_path !== null) {
    data.lifecycleState = input.duration_seconds !== undefined && input.duration_seconds !== null
      ? 'FINALIZED'
      : existing.lifecycleState === 'RECORDING' ? 'UPLOADED' : existing.lifecycleState
  }
  if (input.duration_seconds !== undefined && input.duration_seconds !== null &&
      (input.audio_storage_path !== undefined ? input.audio_storage_path : existing.audioStoragePath)) {
    data.lifecycleState = 'FINALIZED'
  }

  const row = await prisma.recordingSession.update({ where: { id }, data })
  return toPublic(row)
}

export async function deleteRecording(businessId: string, id: string): Promise<void> {
  const existing = await prisma.recordingSession.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Recording not found')
  await prisma.recordingSession.delete({ where: { id } })
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
  const rec = await prisma.recordingSession.findFirst({
    where: { id: recordingId, businessId },
    select: { id: true },
  })
  if (!rec) throw new Error('Recording not found')

  if (replace) {
    await prisma.transcriptionSegment.deleteMany({
      where: { recordingSessionId: recordingId },
    })
  }

  if (segments.length > 0) {
    try {
      await prisma.transcriptionSegment.createMany({
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
    } catch (err) {
      if (isUniqueViolation(err, 'segment_index')) throw new SegmentConflictError()
      throw err
    }
  }

  const rows = await prisma.transcriptionSegment.findMany({
    where: { recordingSessionId: recordingId },
    orderBy: { segmentIndex: 'asc' },
  })
  return rows.map(segmentToPublic)
}
