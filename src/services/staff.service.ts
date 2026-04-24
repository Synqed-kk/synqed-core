import { prisma } from '../db/client.js'
import type { StaffRole } from '@prisma/client'
import type { CreateStaffInput, UpdateStaffInput } from '../validations/staff.js'
import { hashPin } from './crypto.js'
import { getStorage } from './storage.js'

export class StaffLastMemberError extends Error {
  constructor() {
    super('Cannot delete the last staff member.')
    this.name = 'StaffLastMemberError'
  }
}

export class StaffAttributedRecordsError extends Error {
  constructor(public count: number) {
    super(`This staff member has ${count} karute record${count === 1 ? '' : 's'} and cannot be deleted.`)
    this.name = 'StaffAttributedRecordsError'
  }
}

export interface StaffPublic {
  id: string
  tenant_id: string
  user_id: string | null
  name: string
  name_kana: string | null
  email: string | null
  role: StaffRole
  is_active: boolean
  avatar_url: string | null
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
  avatarUrl?: string | null
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
    avatar_url: row.avatarUrl ?? null,
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

  const [totalCount, recordCount] = await Promise.all([
    prisma.staff.count({ where: { tenantId } }),
    prisma.karuteRecord.count({ where: { tenantId, staffId: id } }),
  ])

  if (totalCount <= 1) throw new StaffLastMemberError()
  if (recordCount > 0) throw new StaffAttributedRecordsError(recordCount)

  await prisma.staff.delete({ where: { id } })
}

export async function setPin(tenantId: string, staffId: string, pin: string): Promise<void> {
  const result = await prisma.staff.updateMany({
    where: { id: staffId, tenantId },
    data: { pinHash: hashPin(pin) },
  })
  if (result.count === 0) throw new Error('Staff not found')
}

export async function removePin(tenantId: string, staffId: string): Promise<void> {
  const result = await prisma.staff.updateMany({
    where: { id: staffId, tenantId },
    data: { pinHash: null },
  })
  if (result.count === 0) throw new Error('Staff not found')
}

export async function verifyPin(
  tenantId: string,
  staffId: string,
  pin: string,
): Promise<{ valid: boolean; no_pin?: boolean }> {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId },
    select: { pinHash: true },
  })
  if (!staff) throw new Error('Staff not found')
  if (!staff.pinHash) return { valid: true, no_pin: true }
  return { valid: hashPin(pin) === staff.pinHash }
}

export async function hasPin(tenantId: string, staffId: string): Promise<{ has_pin: boolean }> {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId },
    select: { pinHash: true },
  })
  if (!staff) throw new Error('Staff not found')
  return { has_pin: !!staff.pinHash }
}

export async function uploadAvatar(
  tenantId: string,
  staffId: string,
  file: File,
): Promise<{ avatar_url: string }> {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId },
    select: { id: true },
  })
  if (!staff) throw new Error('Staff not found')

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${tenantId}/${staffId}.${ext}`

  const storage = getStorage()
  const { error: uploadError } = await storage
    .from('avatars')
    .upload(path, file, { upsert: true })
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = storage.from('avatars').getPublicUrl(path)

  await prisma.staff.update({
    where: { id: staffId },
    data: { avatarUrl: publicUrl },
  })

  return { avatar_url: publicUrl }
}
