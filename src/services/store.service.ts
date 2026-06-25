import { prisma } from '../db/client.js'
import type { CreateStoreInput, UpdateStoreInput } from '../validations/store.js'

export interface StorePublic {
  id: string
  business_id: string
  name: string
  address: string | null
  phone: string | null
  is_primary: boolean
  active: boolean
  created_at: string
  updated_at: string
}

function toPublic(row: {
  id: string
  businessId: string
  name: string
  address: string | null
  phone: string | null
  isPrimary: boolean
  active: boolean
  createdAt: Date
  updatedAt: Date
}): StorePublic {
  return {
    id: row.id,
    business_id: row.businessId,
    name: row.name,
    address: row.address,
    phone: row.phone,
    is_primary: row.isPrimary,
    active: row.active,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listStores(businessId: string): Promise<StorePublic[]> {
  const rows = await prisma.store.findMany({
    where: { businessId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
  return rows.map(toPublic)
}

export async function getStore(businessId: string, id: string): Promise<StorePublic | null> {
  const row = await prisma.store.findFirst({ where: { id, businessId } })
  return row ? toPublic(row) : null
}

export async function createStore(
  businessId: string,
  input: CreateStoreInput,
): Promise<StorePublic> {
  const row = await prisma.store.create({
    data: {
      businessId,
      name: input.name,
      address: input.address ?? null,
      phone: input.phone ?? null,
      isPrimary: input.is_primary ?? false,
      active: input.active ?? true,
    },
  })
  return toPublic(row)
}

export async function updateStore(
  businessId: string,
  id: string,
  input: UpdateStoreInput,
): Promise<StorePublic> {
  const existing = await prisma.store.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Store not found')

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name
  if (input.address !== undefined) data.address = input.address
  if (input.phone !== undefined) data.phone = input.phone
  if (input.active !== undefined) data.active = input.active

  const row = await prisma.store.update({ where: { id }, data })
  return toPublic(row)
}
