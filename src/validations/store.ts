import { z } from 'zod'

export const createStoreSchema = z.object({
  name: z.string().min(1),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  is_primary: z.boolean().optional(),
  active: z.boolean().optional(),
})

export const updateStoreSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  active: z.boolean().optional(),
})

export type CreateStoreInput = z.infer<typeof createStoreSchema>
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>
