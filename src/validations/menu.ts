import { z } from 'zod'

// Money rule: integer minor-unit-free amounts + explicit ISO currency code —
// no yen hardcode anywhere (multi-country roadmap). Band invariant
// (min ≤ list) is enforced here AND by a DB CHECK constraint.
const priceFields = {
  price_list_amount: z.number().int().min(0),
  price_min_amount: z.number().int().min(0).nullable().optional(),
  currency: z.string().length(3).optional(),
}

export const createMenuSchema = z
  .object({
    store_id: z.string().uuid().nullish(),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    category_display_order: z.number().int().optional(),
    display_order: z.number().int().optional(),
    duration_minutes: z.number().int().min(1).max(1440),
    ...priceFields,
    tax_included: z.boolean().optional(),
    nomination_allowed: z.boolean().optional(),
    online_visible: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => v.price_min_amount == null || v.price_min_amount <= v.price_list_amount,
    { message: 'price_min_amount must not exceed price_list_amount' },
  )

export const updateMenuSchema = z
  .object({
    store_id: z.string().uuid().nullish(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    category_display_order: z.number().int().optional(),
    display_order: z.number().int().optional(),
    duration_minutes: z.number().int().min(1).max(1440).optional(),
    price_list_amount: z.number().int().min(0).optional(),
    price_min_amount: z.number().int().min(0).nullable().optional(),
    currency: z.string().length(3).optional(),
    tax_included: z.boolean().optional(),
    nomination_allowed: z.boolean().optional(),
    online_visible: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
// Cross-field band validity on partial updates is checked in the service
// against the row's effective values (zod can't see the existing row).

export const listMenusSchema = z.object({
  store_id: z.string().uuid().optional(),
  active: z.coerce.boolean().optional(),
  online_visible: z.coerce.boolean().optional(),
})

export type CreateMenuInput = z.infer<typeof createMenuSchema>
export type UpdateMenuInput = z.infer<typeof updateMenuSchema>
export type ListMenusInput = z.infer<typeof listMenusSchema>
