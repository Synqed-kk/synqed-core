import { z } from 'zod'

export const karuteStatusSchema = z.enum(['DRAFT', 'REVIEW', 'APPROVED'])

export const entryCategorySchema = z.enum([
  'SYMPTOM',
  'TREATMENT',
  'BODY_AREA',
  'PREFERENCE',
  'LIFESTYLE',
  'NEXT_VISIT',
  'PRODUCT',
  'OTHER',
])

export const entryInputSchema = z.object({
  category: entryCategorySchema,
  content: z.string(),
  original_quote: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  tags: z.array(z.string()).optional(),
  sort_order: z.number().int().optional(),
  is_manual: z.boolean().optional(),
})

export const createKaruteRecordSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  staff_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullable().optional(),
  recording_session_id: z.string().uuid().nullable().optional(),
  status: karuteStatusSchema.optional(),
  ai_summary: z.string().nullable().optional(),
  entries: z.array(entryInputSchema).optional(),
})

export const updateKaruteRecordSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  status: karuteStatusSchema.optional(),
  ai_summary: z.string().nullable().optional(),
  entries: z.array(entryInputSchema).optional(), // if present, replaces all
})

export const listKaruteRecordsSchema = z.object({
  customer_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  recording_session_id: z.string().uuid().optional(),
  status: karuteStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
})

export type CreateKaruteRecordInput = z.infer<typeof createKaruteRecordSchema>
export type UpdateKaruteRecordInput = z.infer<typeof updateKaruteRecordSchema>
export type EntryInput = z.infer<typeof entryInputSchema>
