import { z } from 'zod'

export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  furigana: z.string().max(100).nullish(),
  email: z.string().email('Invalid email').max(255).nullish(),
  phone: z.string().max(20).nullish(),
  locale: z.string().max(5).default('ja'),
  notes: z.string().max(5000).nullish(),
  contact_info: z.string().max(1000).nullish(),
  assigned_staff_id: z.string().uuid().nullish(),
})

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  furigana: z.string().max(100).nullish(),
  email: z.string().email('Invalid email').max(255).nullish(),
  phone: z.string().max(20).nullish(),
  locale: z.string().max(5).optional(),
  notes: z.string().max(5000).nullish(),
  contact_info: z.string().max(1000).nullish(),
  assigned_staff_id: z.string().uuid().nullish(),
})

export const listCustomersSchema = z.object({
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  sort_by: z.enum(['name', 'created_at', 'updated_at']).default('name'),
  sort_order: z.enum(['asc', 'desc']).default('asc'),
})
