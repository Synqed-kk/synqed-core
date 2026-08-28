import { prisma } from '../db/client.js'
import type { RoomClass } from '@prisma/client'
import type { CreateMenuInput, ListMenusInput, UpdateMenuInput } from '../validations/menu.js'

export class MenuBandInvalidError extends Error {
  constructor(message = 'price_min_amount must not exceed price_list_amount.') {
    super(message)
    this.name = 'MenuBandInvalidError'
  }
}

/** required_qualification_id must name a qualification of the SAME business —
 *  the FK alone would allow cross-tenant links. */
export class MenuQualificationNotFoundError extends Error {
  constructor(message = 'Qualification not found.') {
    super(message)
    this.name = 'MenuQualificationNotFoundError'
  }
}

async function assertQualification(businessId: string, id: string): Promise<void> {
  const row = await prisma.qualification.findFirst({
    where: { id, businessId },
    select: { id: true },
  })
  if (!row) throw new MenuQualificationNotFoundError()
}

export interface MenuPublic {
  id: string
  business_id: string
  store_id: string | null
  name: string
  description: string | null
  category: string | null
  category_display_order: number
  display_order: number
  duration_minutes: number
  price_list_amount: number
  price_min_amount: number | null
  currency: string
  tax_included: boolean
  nomination_allowed: boolean
  online_visible: boolean
  active: boolean
  /** Bed plane: room class this treatment requires (null = any bed). */
  required_room_class: 'standard' | 'private' | null
  /** Qualification this treatment requires (null = anyone). Informational —
   *  readers filter bookable staff; no booking-time enforcement. */
  required_qualification_id: string | null
  created_at: string
  updated_at: string
}

type MenuRow = {
  id: string
  businessId: string
  storeId: string | null
  name: string
  description: string | null
  category: string | null
  categoryDisplayOrder: number
  displayOrder: number
  durationMinutes: number
  priceListAmount: number
  priceMinAmount: number | null
  currency: string
  taxIncluded: boolean
  nominationAllowed: boolean
  onlineVisible: boolean
  active: boolean
  requiredRoomClass: RoomClass | null
  requiredQualificationId: string | null
  createdAt: Date
  updatedAt: Date
}

function toPublic(row: MenuRow): MenuPublic {
  return {
    id: row.id,
    business_id: row.businessId,
    store_id: row.storeId,
    name: row.name,
    description: row.description,
    category: row.category,
    category_display_order: row.categoryDisplayOrder,
    display_order: row.displayOrder,
    duration_minutes: row.durationMinutes,
    price_list_amount: row.priceListAmount,
    price_min_amount: row.priceMinAmount,
    currency: row.currency,
    tax_included: row.taxIncluded,
    nomination_allowed: row.nominationAllowed,
    online_visible: row.onlineVisible,
    active: row.active,
    required_room_class:
      row.requiredRoomClass === 'private_room' ? 'private'
      : row.requiredRoomClass === 'standard' ? 'standard'
      : null,
    required_qualification_id: row.requiredQualificationId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listMenus(businessId: string, q: ListMenusInput): Promise<MenuPublic[]> {
  const rows = await prisma.menu.findMany({
    where: {
      businessId,
      // store_id filter returns that store's menus PLUS all-store (null) menus
      // — a store's bookable catalog is the union, not the intersection.
      ...(q.store_id !== undefined ? { OR: [{ storeId: q.store_id }, { storeId: null }] } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.online_visible !== undefined ? { onlineVisible: q.online_visible } : {}),
    },
    orderBy: [{ categoryDisplayOrder: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(toPublic)
}

export async function getMenu(businessId: string, id: string): Promise<MenuPublic | null> {
  const row = await prisma.menu.findFirst({ where: { id, businessId } })
  return row ? toPublic(row) : null
}

export async function createMenu(businessId: string, input: CreateMenuInput): Promise<MenuPublic> {
  if (input.required_qualification_id) {
    await assertQualification(businessId, input.required_qualification_id)
  }
  const row = await prisma.menu.create({
    data: {
      businessId,
      storeId: input.store_id ?? null,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      categoryDisplayOrder: input.category_display_order ?? 0,
      displayOrder: input.display_order ?? 0,
      durationMinutes: input.duration_minutes,
      priceListAmount: input.price_list_amount,
      priceMinAmount: input.price_min_amount ?? null,
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.tax_included !== undefined ? { taxIncluded: input.tax_included } : {}),
      ...(input.nomination_allowed !== undefined ? { nominationAllowed: input.nomination_allowed } : {}),
      ...(input.online_visible !== undefined ? { onlineVisible: input.online_visible } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.required_room_class !== undefined
        ? { requiredRoomClass: input.required_room_class === null ? null : (input.required_room_class === 'private' ? 'private_room' : 'standard') as RoomClass }
        : {}),
      ...(input.required_qualification_id !== undefined
        ? { requiredQualificationId: input.required_qualification_id }
        : {}),
    },
  })
  return toPublic(row)
}

export async function updateMenu(
  businessId: string,
  id: string,
  input: UpdateMenuInput,
): Promise<MenuPublic> {
  const existing = await prisma.menu.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Menu not found')

  // Band invariant on the EFFECTIVE values — a partial update changing only
  // one side must not invert the band (DB CHECK is the backstop).
  const effList = input.price_list_amount ?? existing.priceListAmount
  const effMin = input.price_min_amount !== undefined ? input.price_min_amount : existing.priceMinAmount
  if (effMin !== null && effMin > effList) throw new MenuBandInvalidError()

  const data: Record<string, unknown> = {}
  if (input.store_id !== undefined) data.storeId = input.store_id
  if (input.required_qualification_id !== undefined) {
    if (input.required_qualification_id) {
      await assertQualification(businessId, input.required_qualification_id)
    }
    data.requiredQualificationId = input.required_qualification_id
  }
  if (input.required_room_class !== undefined)
    data.requiredRoomClass = input.required_room_class === null ? null : (input.required_room_class === 'private' ? 'private_room' : 'standard')
  if (input.name !== undefined) data.name = input.name
  if (input.description !== undefined) data.description = input.description
  if (input.category !== undefined) data.category = input.category
  if (input.category_display_order !== undefined) data.categoryDisplayOrder = input.category_display_order
  if (input.display_order !== undefined) data.displayOrder = input.display_order
  if (input.duration_minutes !== undefined) data.durationMinutes = input.duration_minutes
  if (input.price_list_amount !== undefined) data.priceListAmount = input.price_list_amount
  if (input.price_min_amount !== undefined) data.priceMinAmount = input.price_min_amount
  if (input.currency !== undefined) data.currency = input.currency
  if (input.tax_included !== undefined) data.taxIncluded = input.tax_included
  if (input.nomination_allowed !== undefined) data.nominationAllowed = input.nomination_allowed
  if (input.online_visible !== undefined) data.onlineVisible = input.online_visible
  if (input.active !== undefined) data.active = input.active

  const row = await prisma.menu.update({ where: { id }, data })
  return toPublic(row)
}
