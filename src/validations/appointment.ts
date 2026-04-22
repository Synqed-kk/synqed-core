import { z } from 'zod'

export const appointmentStatusSchema = z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
export const appointmentSourceSchema = z.enum([
  'MANUAL',
  'QUICKRESERVE',
  'SYNQED_RESERVE',
  'SALON_BOARD',
  'HOT_PEPPER',
  'OTHER',
])

export const createAppointmentSchema = z.object({
  customer_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  duration_minutes: z.number().int().min(1).max(1440).optional(),
  title: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: appointmentStatusSchema.optional(),
  source: appointmentSourceSchema.optional(),
})

export const updateAppointmentSchema = z
  .object({
    customer_id: z.string().uuid().optional(),
    staff_id: z.string().uuid().optional(),
    starts_at: z.string().datetime().optional(),
    ends_at: z.string().datetime().optional(),
    duration_minutes: z.number().int().min(1).max(1440).nullable().optional(),
    title: z.string().max(500).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    status: appointmentStatusSchema.optional(),
  })
  .strict()

export const listAppointmentsSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  staff_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  status: appointmentStatusSchema.optional(),
  source: appointmentSourceSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
})

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>
