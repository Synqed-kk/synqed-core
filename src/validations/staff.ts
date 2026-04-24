import { z } from 'zod'

export const staffRoleSchema = z.enum(['OWNER', 'ADMIN', 'STYLIST', 'ASSISTANT'])

export const createStaffSchema = z.object({
  name: z.string().min(1).max(200),
  name_kana: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  role: staffRoleSchema.optional(),
  is_active: z.boolean().optional(),
})

export const updateStaffSchema = createStaffSchema.partial()

export const listStaffSchema = z.object({
  search: z.string().optional(),
  is_active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
})

export const setPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
})

export const verifyPinSchema = z.object({
  pin: z.string(),
})

export type CreateStaffInput = z.infer<typeof createStaffSchema>
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>
export type SetPinInput = z.infer<typeof setPinSchema>
