import { prisma } from '../db/client.js'
import type { RoomClass } from '@prisma/client'

// The bed plane's CRUD. Resources are never hard-deleted (active flag, same
// posture as menus) — bookings reference them forever.

export class InvalidResourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidResourceError'
  }
}

export interface ResourcePublic {
  id: string
  store_id: string
  name: string
  note: string | null
  room_class: 'standard' | 'private'
  cleanup_minutes: number
  display_order: number
  active: boolean
  created_at: string
  updated_at: string
}

// Prisma maps the SQL enum value 'private' to the client literal
// 'private_room' (reserved-word dodge in the schema); the API speaks the
// settled two-value vocabulary.
function classOut(c: RoomClass): 'standard' | 'private' {
  return c === 'private_room' ? 'private' : 'standard'
}
function classIn(c: 'standard' | 'private'): RoomClass {
  return c === 'private' ? 'private_room' : 'standard'
}

function toPublic(r: {
  id: string
  storeId: string
  name: string
  note: string | null
  roomClass: RoomClass
  cleanupMinutes: number
  displayOrder: number
  active: boolean
  createdAt: Date
  updatedAt: Date
}): ResourcePublic {
  return {
    id: r.id,
    store_id: r.storeId,
    name: r.name,
    note: r.note,
    room_class: classOut(r.roomClass),
    cleanup_minutes: r.cleanupMinutes,
    display_order: r.displayOrder,
    active: r.active,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }
}

export async function listResources(
  businessId: string,
  options: { store_id?: string; active?: boolean } = {},
): Promise<{ resources: ResourcePublic[] }> {
  const where: Record<string, unknown> = { businessId }
  if (options.store_id) where.storeId = options.store_id
  if (options.active !== undefined) where.active = options.active
  const rows = await prisma.resource.findMany({
    where,
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return { resources: rows.map(toPublic) }
}

export interface CreateResourceInput {
  store_id: string
  name: string
  note?: string | null
  room_class?: 'standard' | 'private'
  cleanup_minutes?: number
  display_order?: number
}

export async function createResource(
  businessId: string,
  input: CreateResourceInput,
): Promise<ResourcePublic> {
  const store = await prisma.store.findFirst({
    where: { id: input.store_id, businessId },
    select: { id: true },
  })
  if (!store) throw new InvalidResourceError('Store not found in this business.')
  const row = await prisma.resource.create({
    data: {
      businessId,
      storeId: input.store_id,
      name: input.name,
      note: input.note ?? null,
      roomClass: classIn(input.room_class ?? 'standard'),
      cleanupMinutes: input.cleanup_minutes ?? 0,
      displayOrder: input.display_order ?? 0,
    },
  })
  return toPublic(row)
}

export interface UpdateResourceInput {
  name?: string
  note?: string | null
  room_class?: 'standard' | 'private'
  cleanup_minutes?: number
  display_order?: number
  active?: boolean
}

export async function updateResource(
  businessId: string,
  id: string,
  input: UpdateResourceInput,
): Promise<ResourcePublic | null> {
  const existing = await prisma.resource.findFirst({ where: { id, businessId } })
  if (!existing) return null
  const row = await prisma.resource.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.room_class !== undefined ? { roomClass: classIn(input.room_class) } : {}),
      ...(input.cleanup_minutes !== undefined ? { cleanupMinutes: input.cleanup_minutes } : {}),
      ...(input.display_order !== undefined ? { displayOrder: input.display_order } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  })
  return toPublic(row)
}

/** Resource claimed on a booking: validate it belongs to the business (and
 *  the booking's store, when the booking carries one) and return the
 *  occupancy end = ends_at + cleanup snapshot. */
export async function occupancyFor(
  businessId: string,
  resourceId: string,
  storeId: string | null,
  endsAt: Date,
): Promise<Date> {
  const r = await prisma.resource.findFirst({
    where: { id: resourceId, businessId },
    select: { storeId: true, cleanupMinutes: true, active: true },
  })
  if (!r) throw new InvalidResourceError('Resource not found in this business.')
  if (!r.active) throw new InvalidResourceError('Resource is not active.')
  if (storeId && r.storeId !== storeId) {
    throw new InvalidResourceError('Resource belongs to a different store.')
  }
  return new Date(endsAt.getTime() + r.cleanupMinutes * 60_000)
}
