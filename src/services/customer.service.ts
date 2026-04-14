import { prisma } from '../db/client.js'
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersResponse,
  CheckDuplicateResponse,
} from '../types/api.js'

function toCustomer(row: any): Customer {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    name: row.name,
    furigana: row.furigana,
    email: row.email,
    phone: row.phone,
    locale: row.locale,
    notes: row.notes,
    contact_info: row.contactInfo,
    assigned_staff_id: row.assignedStaffId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listCustomers(
  tenantId: string,
  options: {
    search?: string
    page?: number
    page_size?: number
    sort_by?: string
    sort_order?: string
  }
): Promise<ListCustomersResponse> {
  const page = options.page ?? 1
  const pageSize = options.page_size ?? 20
  const sortOrder = options.sort_order ?? 'asc'
  const offset = (page - 1) * pageSize

  // Map API sort_by to Prisma field names
  const sortByMap: Record<string, string> = {
    name: 'name',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
  }
  const sortBy = sortByMap[options.sort_by ?? 'name'] ?? 'name'

  const where: any = { tenantId }

  if (options.search) {
    where.OR = [
      { name: { contains: options.search, mode: 'insensitive' } },
      { furigana: { contains: options.search, mode: 'insensitive' } },
      { email: { contains: options.search, mode: 'insensitive' } },
      { phone: { contains: options.search, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: offset,
      take: pageSize,
    }),
    prisma.customer.count({ where }),
  ])

  return {
    customers: rows.map(toCustomer),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  }
}

export async function getCustomer(
  tenantId: string,
  id: string
): Promise<Customer | null> {
  const row = await prisma.customer.findFirst({
    where: { id, tenantId },
  })

  return row ? toCustomer(row) : null
}

export async function createCustomer(
  tenantId: string,
  input: CreateCustomerInput
): Promise<Customer> {
  const row = await prisma.customer.create({
    data: {
      tenantId,
      name: input.name,
      furigana: input.furigana ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      locale: input.locale ?? 'ja',
      notes: input.notes ?? null,
      contactInfo: input.contact_info ?? null,
      assignedStaffId: input.assigned_staff_id ?? null,
    },
  })

  return toCustomer(row)
}

export async function updateCustomer(
  tenantId: string,
  id: string,
  input: UpdateCustomerInput
): Promise<Customer> {
  // Check existence first
  const existing = await prisma.customer.findFirst({
    where: { id, tenantId },
  })

  if (!existing) throw new Error('Customer not found')

  // Map API field names to Prisma field names
  const data: any = {}
  if (input.name !== undefined) data.name = input.name
  if (input.furigana !== undefined) data.furigana = input.furigana
  if (input.email !== undefined) data.email = input.email
  if (input.phone !== undefined) data.phone = input.phone
  if (input.locale !== undefined) data.locale = input.locale
  if (input.notes !== undefined) data.notes = input.notes
  if (input.contact_info !== undefined) data.contactInfo = input.contact_info
  if (input.assigned_staff_id !== undefined) data.assignedStaffId = input.assigned_staff_id

  const row = await prisma.customer.update({
    where: { id },
    data,
  })

  return toCustomer(row)
}

export async function deleteCustomer(
  tenantId: string,
  id: string
): Promise<void> {
  // Verify tenant ownership before deleting
  const existing = await prisma.customer.findFirst({
    where: { id, tenantId },
  })

  if (!existing) throw new Error('Customer not found')

  await prisma.customer.delete({ where: { id } })
}

export async function checkDuplicateName(
  tenantId: string,
  name: string
): Promise<CheckDuplicateResponse> {
  const existing = await prisma.customer.findFirst({
    where: {
      tenantId,
      name: { equals: name, mode: 'insensitive' },
    },
    select: { name: true },
  })

  if (existing) {
    return { exists: true, existing_name: existing.name }
  }

  return { exists: false }
}
