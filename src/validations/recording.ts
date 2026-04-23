import { z } from 'zod'

export const recordingStatusSchema = z.enum([
  'RECORDING',
  'UPLOADING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
])

export const createRecordingSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  staff_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullable().optional(),
  audio_storage_path: z.string().max(500).nullable().optional(),
  duration_seconds: z.number().int().nullable().optional(),
  status: recordingStatusSchema.optional(),
  created_at: z.string().datetime().optional(),
})

export const updateRecordingSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  audio_storage_path: z.string().max(500).nullable().optional(),
  duration_seconds: z.number().int().nullable().optional(),
  status: recordingStatusSchema.optional(),
})

export const listRecordingsSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customer_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  status: recordingStatusSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
})

export const segmentSchema = z.object({
  segment_index: z.number().int().min(0),
  text: z.string(),
  start_time: z.number(),
  end_time: z.number(),
  speaker_label: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
})

export const bulkSegmentsSchema = z.object({
  segments: z.array(segmentSchema),
  replace: z.boolean().optional(),
})

export type CreateRecordingInput = z.infer<typeof createRecordingSchema>
export type UpdateRecordingInput = z.infer<typeof updateRecordingSchema>
export type SegmentInput = z.infer<typeof segmentSchema>
