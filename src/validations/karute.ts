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
  store_id: z.string().uuid().nullish(),
  staff_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullable().optional(),
  recording_session_id: z.string().uuid().nullable().optional(),
  status: karuteStatusSchema.optional(),
  ai_summary: z.string().nullable().optional(),
  transcript: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  duration_minutes: z.number().int().min(0).nullable().optional(),
  session_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .nullable()
    .optional(),
  entries: z.array(entryInputSchema).optional(),
})

export const updateKaruteRecordSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  appointment_id: z.string().uuid().nullable().optional(),
  status: karuteStatusSchema.optional(),
  ai_summary: z.string().nullable().optional(),
  // Human overlay — the pencil's summary correction. AI paths must never send it.
  edited_summary: z.string().nullable().optional(),
  transcript: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  duration_minutes: z.number().int().min(0).nullable().optional(),
  session_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .nullable()
    .optional(),
  entries: z.array(entryInputSchema).optional(), // if present, replaces all (atomic)
  // Audit lineage for the entries replace / summary edit
  actor_staff_id: z.string().uuid().nullable().optional(),
  prompt_version: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
})

export const entryEditActionSchema = z.enum([
  'CREATE',
  'EDIT',
  'DELETE',
  'REGEN_REPLACE',
  'ADOPT_AI',
  'DISMISS_AI',
])

export const updateEntrySchema = z.object({
  category: entryCategorySchema.optional(),
  content: z.string().optional(),
  original_quote: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  sort_order: z.number().int().optional(),
  // Optimistic concurrency — the version the editor loaded. 409 on mismatch.
  expected_version: z.number().int().min(1),
  actor_staff_id: z.string().uuid().nullable().optional(),
  action: entryEditActionSchema.optional(),
  prompt_version: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
})

export const entryMutationMetaSchema = z.object({
  actor_staff_id: z.string().uuid().nullable().optional(),
  action: entryEditActionSchema.optional(),
  prompt_version: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
})

export const listEntryEditsSchema = z.object({
  karute_record_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
})

export const listKaruteRecordsSchema = z.object({
  customer_id: z.string().uuid().optional(),
  store_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  appointment_id: z.string().uuid().optional(),
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
