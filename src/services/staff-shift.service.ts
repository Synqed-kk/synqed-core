import type { Prisma, StaffShift } from '@prisma/client'
import { prisma } from '../db/client.js'
import { isUniqueViolation } from '../db/prisma-errors.js'
import type { ActorContext } from '../types/api.js'
import {
  shiftWindowSchema, type CreateStaffShiftInput, type UpdateStaffShiftInput,
  type ListStaffShiftsInput,
} from '../validations/staff-shift.js'

export class StaffShiftError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409) { super(message) }
}

function assertCanManage(actor: ActorContext, storeId: string) {
  if (!actor.capabilities.includes('staff.manage') ||
    (actor.visibleStoreIds !== null && !actor.visibleStoreIds.includes(storeId))) {
    throw new StaffShiftError('Not permitted to manage shifts for this store', 403)
  }
}

function toPublic(row: StaffShift) {
  return {
    id: row.id, business_id: row.businessId, store_id: row.storeId, staff_id: row.staffId,
    date: row.date.toISOString().slice(0, 10), start: row.startMinute, end: row.endMinute,
    breaks: row.breaks, blocks: row.blocks, created_by: row.createdBy, updated_by: row.updatedBy,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  }
}

function validateWindow(input: unknown) {
  const parsed = shiftWindowSchema.safeParse(input)
  if (!parsed.success) throw new StaffShiftError(parsed.error.issues[0].message, 400)
  return parsed.data
}

export async function listStaffShifts(businessId: string, q: ListStaffShiftsInput) {
  const where: Prisma.StaffShiftWhereInput = {
    businessId,
    ...(q.store_id ? { storeId: q.store_id } : {}),
    ...(q.staff_id ? { staffId: q.staff_id } : {}),
    date: {
      ...(q.date ? { equals: new Date(q.date) } : {}),
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lt: new Date(q.to) } : {}),
    },
  }
  const [rows, total] = await prisma.$transaction([
    prisma.staffShift.findMany({ where, orderBy: [{ date: 'asc' }, { staffId: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.page_size, take: q.page_size }),
    prisma.staffShift.count({ where }),
  ])
  return { shifts: rows.map(toPublic), total, page: q.page, page_size: q.page_size }
}

export async function getStaffShift(businessId: string, id: string) {
  const row = await prisma.staffShift.findFirst({ where: { id, businessId } })
  if (!row) throw new StaffShiftError('Shift not found', 404)
  return toPublic(row)
}

export async function createStaffShift(businessId: string, input: CreateStaffShiftInput, actor: ActorContext) {
  assertCanManage(actor, input.store_id)
  const window = validateWindow(input)
  try {
    return await prisma.$transaction(async tx => {
      // Lock the target, including the empty-assignment case. The roster setter
      // takes the same lock; deletion/deactivation also serialize on this row.
      const staff = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM staff WHERE id = ${input.staff_id}::uuid AND business_id = ${businessId}::uuid AND is_active = true FOR UPDATE
      `
      const store = await tx.store.findFirst({ where: { id: input.store_id, businessId, active: true }, select: { id: true } })
      if (!staff.length || !store) throw new StaffShiftError('Active staff and store must belong to this business', 400)
      const assignments = await tx.staffStore.findMany({ where: { businessId, staffId: input.staff_id }, select: { storeId: true } })
      if (assignments.length && !assignments.some(a => a.storeId === input.store_id)) {
        throw new StaffShiftError('Staff is not assigned to this store', 400)
      }
      return toPublic(await tx.staffShift.create({ data: {
        businessId, staffId: input.staff_id, storeId: input.store_id, date: new Date(input.date),
        startMinute: window.start, endMinute: window.end, breaks: window.breaks, blocks: window.blocks,
        createdBy: actor.staffId, updatedBy: actor.staffId,
      } }))
    })
  } catch (err) {
    if (isUniqueViolation(err, 'date')) throw new StaffShiftError('A shift already exists for this staff, store, and date', 409)
    throw err
  }
}

export async function updateStaffShift(businessId: string, id: string, input: UpdateStaffShiftInput, actor: ActorContext) {
  return prisma.$transaction(async tx => {
    // Validate partial edits against the current locked window, so two edits
    // cannot each pass against stale breaks/hours and produce an invalid shift.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM staff_shifts WHERE id = ${id}::uuid AND business_id = ${businessId}::uuid FOR UPDATE
    `
    if (!rows.length) throw new StaffShiftError('Shift not found', 404)
    const existing = await tx.staffShift.findUniqueOrThrow({ where: { id } })
    assertCanManage(actor, existing.storeId)
    const window = validateWindow({
      start: input.start ?? existing.startMinute, end: input.end ?? existing.endMinute,
      breaks: input.breaks ?? existing.breaks, blocks: input.blocks ?? existing.blocks,
    })
    return toPublic(await tx.staffShift.update({ where: { id, businessId }, data: {
      startMinute: window.start, endMinute: window.end, breaks: window.breaks, blocks: window.blocks,
      updatedBy: actor.staffId,
    } }))
  })
}

export async function deleteStaffShift(businessId: string, id: string, actor: ActorContext) {
  const row = await prisma.staffShift.findFirst({ where: { id, businessId } })
  if (!row) throw new StaffShiftError('Shift not found', 404)
  assertCanManage(actor, row.storeId)
  const result = await prisma.staffShift.deleteMany({ where: { id, businessId, storeId: row.storeId } })
  if (!result.count) throw new StaffShiftError('Shift not found', 404)
}
