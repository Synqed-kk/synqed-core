import { prisma } from '../db/client.js'
import type { StaffRole } from '@prisma/client'
import type { CreateStaffInput, UpdateStaffInput } from '../validations/staff.js'

export interface StaffPublic {
  id: string
  tenant_id: string
  user_id: string | null
  name: string
  name_kana: string | null
  email: string | null
  role: StaffRole
  is_active: boolean
  created_at: string
  updated_at: string
}

function toPublic(row: {
  id: string
  tenantId: string
  userId: string | null
  name: string
  nameKana: string | null
  email: string | null
  role: StaffRole
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}): StaffPublic {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    user_id: row.userId,
    name: row.name,
    name_kana: row.nameKana,
    email: row.email,
    role: row.role,
    is_active: row.isActive,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listStaff(
  tenantId: string,
  options: { search?: string; is_active?: 'true' | 'false'; page?: number; page_size?: number },
): Promise<{ staff: StaffPublic[]; total: number; page: number; page_size: number }> {
  const page = options.page ?? 1
  const pageSize = options.page_size ?? 100
  const offset = (page - 1) * pageSize

  const where: Record<string, unknown> = { tenantId }
  if (options.is_active === 'true') where.isActive = true
  if (options.is_active === 'false') where.isActive = false
  if (options.search) {
    where.OR = [
      { name: { contains: options.search, mode: 'insensitive' } },
      { nameKana: { contains: options.search, mode: 'insensitive' } },
      { email: { contains: options.search, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.staff.findMany({ where, orderBy: { name: 'asc' }, skip: offset, take: pageSize }),
    prisma.staff.count({ where }),
  ])
  return { staff: rows.map(toPublic), total, page, page_size: pageSize }
}

export async function getStaff(tenantId: string, id: string): Promise<StaffPublic | null> {
  const row = await prisma.staff.findFirst({ where: { id, tenantId } })
  return row ? toPublic(row) : null
}

export async function createStaff(
  tenantId: string,
  input: CreateStaffInput,
): Promise<StaffPublic> {
  const row = await prisma.staff.create({
    data: {
      tenantId,
      name: input.name,
      nameKana: input.name_kana ?? null,
      email: input.email ?? null,
      userId: input.user_id ?? null,
      role: input.role ?? 'STYLIST',
      isActive: input.is_active ?? true,
    },
  })
  return toPublic(row)
}

export async function updateStaff(
  tenantId: string,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffPublic> {
  const existing = await prisma.staff.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error('Staff not found')

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name
  if (input.name_kana !== undefined) data.nameKana = input.name_kana
  if (input.email !== undefined) data.email = input.email
  if (input.user_id !== undefined) data.userId = input.user_id
  if (input.role !== undefined) data.role = input.role
  if (input.is_active !== undefined) data.isActive = input.is_active

  const row = await prisma.staff.update({ where: { id }, data })
  return toPublic(row)
}

export async function deleteStaff(tenantId: string, id: string): Promise<void> {
  const existing = await prisma.staff.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error('Staff not found')
  await prisma.staff.delete({ where: { id } })
}
