import { z } from 'zod'

export const appointmentStatusSchema = z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
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
  store_id: z.string().uuid().nullish(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  duration_minutes: z.number().int().min(1).max(1440).optional(),
  title: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  // Booked-menu snapshot: the menu + the price the customer agreed to at
  // write time (soft reference — no FK; see the Menu model note).
  menu_id: z.string().uuid().nullable().optional(),
  // Bed claim (real FK server-side; null = no bed).
  resource_id: z.string().uuid().nullable().optional(),
  booked_price_amount: z.number().int().min(0).nullable().optional(),
  booked_price_currency: z.string().length(3).nullable().optional(),
  status: appointmentStatusSchema.optional(),
  source: appointmentSourceSchema.optional(),
  // Rebook provenance: the booking this one replaces (msg-8 item 5). Must be
  // an appointment of the same business — service-checked, 404 otherwise.
  rebooked_from_appointment_id: z.string().uuid().nullable().optional(),
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
    // Who set the status + why (a reason code like advance-cancel /
    // same-day-contacted / no-show-no-contact). Recorded when status changes.
    status_reason: z.string().max(500).nullable().optional(),
    acting_staff_id: z.string().uuid().optional(),
    // Bed change (null = release the bed).
    resource_id: z.string().uuid().nullable().optional(),
  })
  .strict()

export const listAppointmentsSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  store_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  status: appointmentStatusSchema.optional(),
  source: appointmentSourceSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
})

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>
