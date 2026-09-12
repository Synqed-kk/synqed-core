import { z } from 'zod'

// Preserve sources used by existing Karute/import callers as well as live burns.
export const redemptionSource = z.enum(['manual', 'auto', 'import', 'qr', 'pos', 'backfill', 'recovery', 'correction'])
export const packStatus = z.enum(['active', 'exhausted', 'cancelled', 'void'])
export const isCorrection = (source?: string | null) => source === 'correction' || source === 'recovery'
const reason = z.string().trim().min(1).max(2000).nullish()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')

export const createPackSchema = z.object({
  customer_id: z.string().uuid(), kind: z.string().min(1),
  pack_size: z.number().int(), unit_price: z.number().int(),
  total_price: z.number().int().nullish(), purchase_round: z.number().int().optional(),
  purchased_at: date.nullish(), source: z.string().optional(),
  notes: z.string().nullish(), created_by: z.string().uuid().nullish(),
})

export const addRedemptionSchema = z.object({
  pack_id: z.string().uuid(), customer_id: z.string().uuid(), redeemed_on: date,
  appointment_id: z.string().nullish(), karute_record_id: z.string().nullish(),
  source: redemptionSource.optional(), created_by: z.string().uuid().nullish(),
  counts_as_visit: z.boolean().optional(), reason,
})

export const removeRedemptionSchema = z.object({
  source: redemptionSource.optional(), reason, removed_by: z.string().uuid().nullish(),
})

export const recentRedemptionsSchema = z.object({
  since: date,
  include_removed: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
})
