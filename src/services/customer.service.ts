import { prisma } from '../db/client.js'
import { getStorage } from './storage.js'
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersResponse,
  CheckDuplicateResponse,
} from '../types/api.js'

const PHOTO_BUCKET = 'customer-photos'
const PHOTO_SIGNED_URL_TTL_SECONDS = 3600

function toCustomer(row: any): Customer {
  return {
    id: row.id,
    business_id: row.businessId,
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
  businessId: string,
  options: {
    search?: string
    ids?: string[]
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

  const where: any = { businessId }

  // Batch-by-id mode: returns only the requested customers in a single shot.
  // Bypasses search/pagination because the caller already knows the exact set.
  if (options.ids && options.ids.length > 0) {
    where.id = { in: options.ids }
    const rows = await prisma.customer.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
    })
    return {
      customers: rows.map(toCustomer),
      total: rows.length,
      page: 1,
      page_size: rows.length,
      total_pages: 1,
    }
  }

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
  businessId: string,
  id: string
): Promise<Customer | null> {
  const row = await prisma.customer.findFirst({
    where: { id, businessId },
  })

  return row ? toCustomer(row) : null
}

export async function createCustomer(
  businessId: string,
  input: CreateCustomerInput
): Promise<Customer> {
  const row = await prisma.customer.create({
    data: {
      businessId,
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
  businessId: string,
  id: string,
  input: UpdateCustomerInput
): Promise<Customer> {
  // Check existence first
  const existing = await prisma.customer.findFirst({
    where: { id, businessId },
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
  businessId: string,
  id: string
): Promise<void> {
  // Verify tenant ownership before deleting
  const existing = await prisma.customer.findFirst({
    where: { id, businessId },
  })

  if (!existing) throw new Error('Customer not found')

  await prisma.customer.delete({ where: { id } })
}

export async function checkDuplicateName(
  businessId: string,
  name: string
): Promise<CheckDuplicateResponse> {
  const existing = await prisma.customer.findFirst({
    where: {
      businessId,
      name: { equals: name, mode: 'insensitive' },
    },
    select: { name: true },
  })

  if (existing) {
    return { exists: true, existing_name: existing.name }
  }

  return { exists: false }
}

// =============================================================================
// Customer photos
// =============================================================================

export interface CustomerPhotoDto {
  id: string
  customer_id: string
  storage_path: string
  category: string
  caption: string | null
  created_at: string
  signed_url: string | null
}

async function toCustomerPhotoDto(row: {
  id: string
  customerId: string
  storagePath: string
  category: string
  caption: string | null
  createdAt: Date
}): Promise<CustomerPhotoDto> {
  const storage = getStorage()
  const { data } = await storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(row.storagePath, PHOTO_SIGNED_URL_TTL_SECONDS)
  return {
    id: row.id,
    customer_id: row.customerId,
    storage_path: row.storagePath,
    category: row.category,
    caption: row.caption,
    created_at: row.createdAt.toISOString(),
    signed_url: data?.signedUrl ?? null,
  }
}

async function assertCustomer(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: { id: true },
  })
  if (!customer) throw new Error('Customer not found')
}

export async function listPhotos(
  businessId: string,
  customerId: string,
): Promise<{ photos: CustomerPhotoDto[] }> {
  await assertCustomer(businessId, customerId)
  const rows = await prisma.customerPhoto.findMany({
    where: { businessId, customerId },
    orderBy: { createdAt: 'desc' },
  })
  const photos = await Promise.all(rows.map(toCustomerPhotoDto))
  return { photos }
}

export async function uploadPhoto(
  businessId: string,
  customerId: string,
  file: File,
  options: { category?: string; caption?: string | null } = {},
): Promise<CustomerPhotoDto> {
  await assertCustomer(businessId, customerId)

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const id = crypto.randomUUID()
  const storagePath = `${businessId}/${customerId}/${id}.${ext}`

  const storage = getStorage()
  const { error: uploadError } = await storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: false })
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const row = await prisma.customerPhoto.create({
    data: {
      id,
      businessId,
      customerId,
      storagePath,
      category: options.category ?? 'general',
      caption: options.caption ?? null,
    },
  })

  return toCustomerPhotoDto(row)
}

export async function deletePhoto(
  businessId: string,
  customerId: string,
  photoId: string,
): Promise<void> {
  const photo = await prisma.customerPhoto.findFirst({
    where: { id: photoId, customerId, businessId },
  })
  if (!photo) throw new Error('Photo not found')

  const storage = getStorage()
  await storage.from(PHOTO_BUCKET).remove([photo.storagePath])
  await prisma.customerPhoto.delete({ where: { id: photo.id } })
}

// =============================================================================
// Recording consent (per-customer, persists across visits)
// =============================================================================

export interface RecordingConsentDto {
  id: string
  customer_id: string
  granted_by_staff_id: string
  granted_at: string
  method: 'VERBAL' | 'WRITTEN'
  policy_version: string
  revoked_at: string | null
  revoked_by_staff_id: string | null
}

function toConsentDto(row: {
  id: string
  customerId: string
  grantedByStaffId: string
  grantedAt: Date
  method: 'VERBAL' | 'WRITTEN'
  policyVersion: string
  revokedAt: Date | null
  revokedByStaffId: string | null
}): RecordingConsentDto {
  return {
    id: row.id,
    customer_id: row.customerId,
    granted_by_staff_id: row.grantedByStaffId,
    granted_at: row.grantedAt.toISOString(),
    method: row.method,
    policy_version: row.policyVersion,
    revoked_at: row.revokedAt?.toISOString() ?? null,
    revoked_by_staff_id: row.revokedByStaffId,
  }
}

/** Returns the active (non-revoked) consent for a customer, or null. */
export async function getConsent(
  businessId: string,
  customerId: string,
): Promise<RecordingConsentDto | null> {
  await assertCustomer(businessId, customerId)
  const row = await prisma.recordingConsent.findFirst({
    where: { businessId, customerId, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  })
  return row ? toConsentDto(row) : null
}

export async function grantConsent(
  businessId: string,
  customerId: string,
  input: {
    grantedByStaffId: string
    method?: 'VERBAL' | 'WRITTEN'
    policyVersion: string
  },
): Promise<RecordingConsentDto> {
  await assertCustomer(businessId, customerId)

  // Revoke any prior active consent so there's only one active row.
  await prisma.recordingConsent.updateMany({
    where: { businessId, customerId, revokedAt: null },
    data: { revokedAt: new Date(), revokedByStaffId: input.grantedByStaffId },
  })

  const row = await prisma.recordingConsent.create({
    data: {
      businessId,
      customerId,
      grantedByStaffId: input.grantedByStaffId,
      method: input.method ?? 'VERBAL',
      policyVersion: input.policyVersion,
    },
  })
  return toConsentDto(row)
}

export async function revokeConsent(
  businessId: string,
  customerId: string,
  revokedByStaffId: string,
): Promise<void> {
  await assertCustomer(businessId, customerId)
  await prisma.recordingConsent.updateMany({
    where: { businessId, customerId, revokedAt: null },
    data: { revokedAt: new Date(), revokedByStaffId },
  })
}
