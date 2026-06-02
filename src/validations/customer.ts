import { z } from 'zod'

export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  furigana: z.string().max(100).nullish(),
  email: z.string().email('Invalid email').max(255).nullish(),
  phone: z.string().max(20).nullish(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').nullish(),
  gender: z.enum(['female', 'male', 'other']).nullish(),
  occupation: z.string().max(255).nullish(),
  member_number: z.string().max(255).nullish(),
  postal_code: z.string().max(20).nullish(),
  prefecture: z.string().max(100).nullish(),
  address: z.string().max(500).nullish(),
  phone2: z.string().max(20).nullish(),
  dm_opt_in: z.boolean().optional(),
  comment: z.string().max(5000).nullish(),
  remarks2: z.string().max(5000).nullish(),
  total_sales: z.number().int().min(0).optional(),
  installment_outstanding: z.number().int().min(0).optional(),
  has_ticket_pack: z.boolean().optional(),
  first_visit_at: z.string().datetime().nullish(),
  last_visit_at: z.string().datetime().nullish(),
  locale: z.string().max(5).default('ja'),
  notes: z.string().max(5000).nullish(),
  contact_info: z.string().max(1000).nullish(),
  assigned_staff_id: z.string().uuid().nullish(),
  is_existing_customer: z.boolean().optional(),
  visit_count: z.number().int().min(0).optional(),
})

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  furigana: z.string().max(100).nullish(),
  email: z.string().email('Invalid email').max(255).nullish(),
  phone: z.string().max(20).nullish(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').nullish(),
  gender: z.enum(['female', 'male', 'other']).nullish(),
  occupation: z.string().max(255).nullish(),
  member_number: z.string().max(255).nullish(),
  postal_code: z.string().max(20).nullish(),
  prefecture: z.string().max(100).nullish(),
  address: z.string().max(500).nullish(),
  phone2: z.string().max(20).nullish(),
  dm_opt_in: z.boolean().optional(),
  comment: z.string().max(5000).nullish(),
  remarks2: z.string().max(5000).nullish(),
  total_sales: z.number().int().min(0).optional(),
  installment_outstanding: z.number().int().min(0).optional(),
  has_ticket_pack: z.boolean().optional(),
  first_visit_at: z.string().datetime().nullish(),
  last_visit_at: z.string().datetime().nullish(),
  locale: z.string().max(5).optional(),
  notes: z.string().max(5000).nullish(),
  contact_info: z.string().max(1000).nullish(),
  assigned_staff_id: z.string().uuid().nullish(),
  is_existing_customer: z.boolean().optional(),
  visit_count: z.number().int().min(0).optional(),
})

export const upsertVisitsSchema = z.object({
  visits: z.array(z.object({
    qr_reservation_id: z.number().int(),
    used_at: z.string().datetime(),
    status: z.string().max(20),
    course_name: z.string().max(255).nullish(),
    sales_amount: z.number().int().default(0),
    staff_name: z.string().max(100).nullish(),
    treatment_comment: z.string().max(5000).nullish(),
  })).max(500),
})

export const listCustomersSchema = z.object({
  search: z.string().max(100).optional(),
  // ids: comma-separated list of customer ids; when set the server returns only
  // those customers (no search, no pagination). Used for batch-lookup callers
  // that want to resolve N customer names in a single request instead of N.
  ids: z
    .string()
    .max(5_000)
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(20),
  sort_by: z.enum(['name', 'created_at', 'updated_at']).default('name'),
  sort_order: z.enum(['asc', 'desc']).default('asc'),
})
