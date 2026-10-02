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

export const appointmentKindSchema = z.enum(['BOOKING', 'BLOCK'])

const createAppointmentBase = z.object({
  requires_private_room: z.boolean().optional(),
  // Required for BOOKING (the default), enforced by the superRefine below +
  // the DB CHECK; a BLOCK is customerless and may be staffless.
  customer_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  kind: appointmentKindSchema.optional(),
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

export const createAppointmentSchema = createAppointmentBase.superRefine((v, ctx) => {
  if ((v.kind ?? 'BOOKING') === 'BOOKING') {
    if (!v.customer_id)
      ctx.addIssue({ code: 'custom', message: 'customer_id is required for a booking' })
    if (!v.staff_id)
      ctx.addIssue({ code: 'custom', message: 'staff_id is required for a booking' })
  } else {
    // A block is customerless by definition and must occupy SOMETHING —
    // staff time or a bed; a row holding neither reserves nothing.
    if (v.customer_id)
      ctx.addIssue({ code: 'custom', message: 'a block cannot have a customer' })
    if (!v.staff_id && !v.resource_id)
      ctx.addIssue({ code: 'custom', message: 'a block must have staff_id or resource_id' })
  }
})

export const updateAppointmentSchema = z
  .object({
    requires_private_room: z.boolean().optional(),
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
  // Repeatable in the query string (status_not=CANCELLED&status_not=NO_SHOW).
  status_not: z.array(appointmentStatusSchema).optional(),
  kind: appointmentKindSchema.optional(),
  source: appointmentSourceSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
})

// 400 days: a year view with margin. The cap bounds the scan; the app's
// largest window today is a 45-day month view.
const MAX_COUNT_WINDOW_MS = 400 * 24 * 60 * 60 * 1000

export const appointmentCountsSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    store_id: z.string().uuid().optional(),
    staff_id: z.string().uuid().optional(),
  })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), { message: 'to must be after from' })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= MAX_COUNT_WINDOW_MS, {
    message: 'The window must be at most 400 days',
  })

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>
