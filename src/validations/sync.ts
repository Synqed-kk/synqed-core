import { z } from 'zod'

export const syncProviderSchema = z.enum(['QUICKRESERVE', 'SYNQED_RESERVE', 'SALON_BOARD', 'HOT_PEPPER'])

export const upsertSyncConfigSchema = z.object({
  username: z.string().min(1).max(200).optional(),
  password: z.string().min(1).max(500).optional(),
  store_slug: z.string().min(1).max(100).optional(),
  store_id: z.number().int().nonnegative().optional(),
  karute_store_id: z.string().uuid(),
  enabled: z.boolean().optional(),
  interval_minutes: z.number().int().min(5).max(1440).optional(),
  business_hours_start: z.number().int().min(0).max(23).optional(),
  business_hours_end: z.number().int().min(0).max(24).optional(),
  timezone: z.string().min(1).max(64).optional(),
  lookahead_days: z.number().int().min(0).max(30).optional(),
})

// POST /:provider/run body: { karute_store_id } runs that row; { all: true }
// runs every row; no body runs the primary store's row (one client release).
export const runSyncSchema = z
  .object({
    karute_store_id: z.string().uuid().optional(),
    all: z.boolean().optional(),
  })
  .refine((b) => !(b.all && b.karute_store_id), 'Send karute_store_id or all, not both')

export type UpsertSyncConfigInput = z.infer<typeof upsertSyncConfigSchema>
