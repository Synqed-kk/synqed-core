import { prisma } from '../db/client.js'
import { getStorage } from './storage.js'
import { isUniqueViolation } from '../db/prisma-errors.js'
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersResponse,
  CheckDuplicateResponse,
  UpsertVisitInput,
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
    // @db.Date column → date-only string (no time component to leak).
    date_of_birth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
    gender: row.gender,
    occupation: row.occupation,
    member_number: row.memberNumber,
    postal_code: row.postalCode,
    prefecture: row.prefecture,
    address: row.address,
    phone2: row.phone2,
    dm_opt_in: row.dmOptIn,
    comment: row.comment,
    remarks2: row.remarks2,
    total_sales: row.totalSales,
    installment_outstanding: row.installmentOutstanding,
    has_ticket_pack: row.hasTicketPack,
    first_visit_at: row.firstVisitAt?.toISOString() ?? null,
    last_visit_at: row.lastVisitAt?.toISOString() ?? null,
    locale: row.locale,
    notes: row.notes,
    contact_info: row.contactInfo,
    assigned_staff_id: row.assignedStaffId,
    is_existing_customer: row.isExistingCustomer,
    visit_count: row.visitCount,
    karute_number: row.karuteNumber ?? null,
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

/**
 * Next per-business chart number (カルテNo). max+1 over the business's
 * customers; the partial-unique index (business_id, karute_number) backstops
 * the rare concurrent-create race with a constraint error.
 */
export async function nextKaruteNumber(businessId: string): Promise<number> {
  const agg = await prisma.customer.aggregate({
    where: { businessId },
    _max: { karuteNumber: true },
  })
  return (agg._max.karuteNumber ?? 0) + 1
}

export async function createCustomer(
  businessId: string,
  input: CreateCustomerInput
): Promise<Customer> {
  // Constraint-aware create — the SINGLE write point every caller funnels
  // through (QR sync, importers, manual add). It must not 500 on the unique
  // keys:
  //  • email already exists → idempotent: return that customer. The QR sync
  //    find-or-creates by NAME and collides on email for the SAME person under
  //    a drifted/unlisted name — that is the live 500. Callers that need
  //    "new only" (manual add) compare the returned name themselves.
  //  • karuteNumber race (nextKaruteNumber is a non-atomic max+1) → retry.
  const data = {
    businessId,
    name: input.name,
    furigana: input.furigana ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    dateOfBirth: input.date_of_birth ? new Date(input.date_of_birth) : null,
    gender: input.gender ?? null,
    occupation: input.occupation ?? null,
    memberNumber: input.member_number ?? null,
    postalCode: input.postal_code ?? null,
    prefecture: input.prefecture ?? null,
    address: input.address ?? null,
    phone2: input.phone2 ?? null,
    dmOptIn: input.dm_opt_in ?? false,
    comment: input.comment ?? null,
    remarks2: input.remarks2 ?? null,
    totalSales: input.total_sales ?? 0,
    installmentOutstanding: input.installment_outstanding ?? 0,
    hasTicketPack: input.has_ticket_pack ?? false,
    firstVisitAt: input.first_visit_at ? new Date(input.first_visit_at) : null,
    lastVisitAt: input.last_visit_at ? new Date(input.last_visit_at) : null,
    locale: input.locale ?? 'ja',
    notes: input.notes ?? null,
    contactInfo: input.contact_info ?? null,
    assignedStaffId: input.assigned_staff_id ?? null,
    isExistingCustomer: input.is_existing_customer ?? false,
    visitCount: input.visit_count ?? 0,
  }
  // Look the email up FIRST so the constant QR-sync dedup (one collision per
  // already-existing customer, every run) doesn't fire a doomed INSERT +
  // prisma:error log each time. The create-time catch below stays as the race
  // fallback (two concurrent creates of the same email).
  if (input.email) {
    const existing = await prisma.customer.findFirst({
      where: { businessId, email: input.email },
    })
    if (existing) return toCustomer(existing)
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await prisma.customer.create({
        data: { ...data, karuteNumber: await nextKaruteNumber(businessId) },
      })
      return toCustomer(row)
    } catch (e) {
      if (input.email && isUniqueViolation(e, 'email')) {
        const existing = await prisma.customer.findFirst({
          where: { businessId, email: input.email },
        })
        if (existing) return toCustomer(existing)
      }
      if (isUniqueViolation(e, 'karuteNumber') && attempt < 4) continue
      throw e
    }
  }
  throw new Error('createCustomer: exhausted karuteNumber retries')
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
  if (input.date_of_birth !== undefined)
    data.dateOfBirth = input.date_of_birth ? new Date(input.date_of_birth) : null
  if (input.gender !== undefined) data.gender = input.gender
  if (input.occupation !== undefined) data.occupation = input.occupation
  if (input.member_number !== undefined) data.memberNumber = input.member_number
  if (input.postal_code !== undefined) data.postalCode = input.postal_code
  if (input.prefecture !== undefined) data.prefecture = input.prefecture
  if (input.address !== undefined) data.address = input.address
  if (input.phone2 !== undefined) data.phone2 = input.phone2
  if (input.dm_opt_in !== undefined) data.dmOptIn = input.dm_opt_in
  if (input.comment !== undefined) data.comment = input.comment
  if (input.remarks2 !== undefined) data.remarks2 = input.remarks2
  if (input.total_sales !== undefined) data.totalSales = input.total_sales
  if (input.installment_outstanding !== undefined)
    data.installmentOutstanding = input.installment_outstanding
  if (input.has_ticket_pack !== undefined) data.hasTicketPack = input.has_ticket_pack
  if (input.first_visit_at !== undefined)
    data.firstVisitAt = input.first_visit_at ? new Date(input.first_visit_at) : null
  if (input.last_visit_at !== undefined)
    data.lastVisitAt = input.last_visit_at ? new Date(input.last_visit_at) : null
  if (input.locale !== undefined) data.locale = input.locale
  if (input.notes !== undefined) data.notes = input.notes
  if (input.contact_info !== undefined) data.contactInfo = input.contact_info
  if (input.assigned_staff_id !== undefined) data.assignedStaffId = input.assigned_staff_id
  if (input.is_existing_customer !== undefined) data.isExistingCustomer = input.is_existing_customer
  if (input.visit_count !== undefined) data.visitCount = input.visit_count

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
// Customer visits — crawled from QuickReserve (one row per reservation).
// Idempotent upsert keyed by (businessId, qrReservationId).
// =============================================================================

export async function upsertVisits(
  businessId: string,
  customerId: string,
  visits: UpsertVisitInput[]
) {
  await Promise.all(visits.map((v) =>
    prisma.customerVisit.upsert({
      where: { businessId_qrReservationId: { businessId, qrReservationId: v.qr_reservation_id } },
      create: {
        businessId,
        customerId,
        qrReservationId: v.qr_reservation_id,
        usedAt: new Date(v.used_at),
        status: v.status,
        courseName: v.course_name ?? null,
        salesAmount: v.sales_amount ?? 0,
        staffName: v.staff_name ?? null,
        treatmentComment: v.treatment_comment ?? null,
      },
      update: {
        usedAt: new Date(v.used_at),
        status: v.status,
        courseName: v.course_name ?? null,
        salesAmount: v.sales_amount ?? 0,
        staffName: v.staff_name ?? null,
        treatmentComment: v.treatment_comment ?? null,
      },
    })))
  return { upserted: visits.length }
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
