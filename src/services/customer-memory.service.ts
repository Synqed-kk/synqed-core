import { prisma } from '../db/client.js'

export interface MemoryItemPublic {
  id: string
  business_id: string
  customer_id: string
  category: string
  label: string
  detail: string | null
  source: string | null
  confidence: number | null
  pinned: boolean
  suggest_talking_point: boolean
  created_at: string
  updated_at: string
}

function toPublic(row: {
  id: string
  businessId: string
  customerId: string
  category: string
  label: string
  detail: string | null
  source: string | null
  confidence: number | null
  pinned: boolean
  suggestTalkingPoint: boolean
  createdAt: Date
  updatedAt: Date
}): MemoryItemPublic {
  return {
    id: row.id,
    business_id: row.businessId,
    customer_id: row.customerId,
    category: row.category,
    label: row.label,
    detail: row.detail,
    source: row.source,
    confidence: row.confidence,
    pinned: row.pinned,
    suggest_talking_point: row.suggestTalkingPoint,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

/** Live (non-deleted) memory items for a customer. */
export async function listMemoryItems(
  businessId: string,
  customerId: string,
): Promise<MemoryItemPublic[]> {
  const rows = await prisma.customerMemoryItem.findMany({
    where: { businessId, customerId, deletedAt: null },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.map(toPublic)
}

export async function createMemoryItem(
  businessId: string,
  input: {
    customer_id: string
    category: string
    label: string
    detail?: string | null
    source?: string | null
    confidence?: number | null
    pinned?: boolean
    suggest_talking_point?: boolean
  },
): Promise<MemoryItemPublic> {
  const row = await prisma.customerMemoryItem.create({
    data: {
      businessId,
      customerId: input.customer_id,
      category: input.category,
      label: input.label,
      detail: input.detail ?? null,
      source: input.source ?? null,
      confidence: input.confidence ?? null,
      pinned: input.pinned ?? false,
      suggestTalkingPoint: input.suggest_talking_point ?? false,
    },
  })
  return toPublic(row)
}

export async function updateMemoryItem(
  businessId: string,
  id: string,
  input: { label?: string; detail?: string | null; pinned?: boolean; suggest_talking_point?: boolean },
): Promise<MemoryItemPublic> {
  const existing = await prisma.customerMemoryItem.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Memory item not found')
  const data: Record<string, unknown> = {}
  if (input.label !== undefined) data.label = input.label
  if (input.detail !== undefined) data.detail = input.detail
  if (input.pinned !== undefined) data.pinned = input.pinned
  if (input.suggest_talking_point !== undefined) data.suggestTalkingPoint = input.suggest_talking_point
  const row = await prisma.customerMemoryItem.update({ where: { id }, data })
  return toPublic(row)
}

/** Soft-delete (sets deleted_at). */
export async function deleteMemoryItem(businessId: string, id: string): Promise<void> {
  const existing = await prisma.customerMemoryItem.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Memory item not found')
  await prisma.customerMemoryItem.update({ where: { id }, data: { deletedAt: new Date() } })
}
