import { z } from 'zod'

export const upsertOrgSettingsSchema = z.object({
  name: z.string().max(200).nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

export type UpsertOrgSettingsInput = z.infer<typeof upsertOrgSettingsSchema>
