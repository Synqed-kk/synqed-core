import { prisma } from '../db/client.js'
import type { AppointmentStatus, AppointmentSource } from '@prisma/client'
import type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
} from '../validations/appointment.js'

export class AppointmentOverlapError extends Error {
  constructor(message = 'This time slot overlaps with an existing booking.') {
    super(message)
    this.name = 'AppointmentOverlapError'
  }
}

export interface AppointmentPublic {
  id: string
  tenant_id: string
  customer_id: string
  staff_id: string
  starts_at: string
  ends_at: string
  duration_minutes: number | null
  title: string | null
  notes: string | null
  status: AppointmentStatus
  source: AppointmentSource
  external_refs: unknown
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

function toPublic(row: {
  id: string
  tenantId: string
  customerId: string
  staffId: string
  startsAt: Date
  endsAt: Date
  durationMinutes: number | null
  title: string | null
  notes: string | null
  status: AppointmentStatus
  source: AppointmentSource
  externalRefs: unknown
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
}): AppointmentPublic {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    customer_id: row.customerId,
    staff_id: row.staffId,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    duration_minutes: row.durationMinutes,
    title: row.title,
    notes: row.notes,
    status: row.status,
    source: row.source,
    external_refs: row.externalRefs,
    cancelled_at: row.cancelledAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listAppointments(
  tenantId: string,
  options: {
    from?: string
    to?: string
    staff_id?: string
    customer_id?: string
    status?: AppointmentStatus
    source?: AppointmentSource
    page?: number
    page_size?: number
  },
): Promise<{
  appointments: AppointmentPublic[]
  total: number
  page: number
  page_size: number
}> {
  const page = options.page ?? 1
  const pageSize = options.page_size ?? 200
  const offset = (page - 1) * pageSize

  const where: Record<string, unknown> = { tenantId }
  if (options.staff_id) where.staffId = options.staff_id
  if (options.customer_id) where.customerId = options.customer_id
  if (options.status) where.status = options.status
  if (options.source) where.source = options.source
  if (options.from || options.to) {
    const range: Record<string, Date> = {}
    if (options.from) range.gte = new Date(options.from)
    if (options.to) range.lt = new Date(options.to)
    where.startsAt = range
  }

  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      skip: offset,
      take: pageSize,
    }),
    prisma.appointment.count({ where }),
  ])
  return { appointments: rows.map(toPublic), total, page, page_size: pageSize }
}

export async function getAppointment(
  tenantId: string,
  id: string,
): Promise<AppointmentPublic | null> {
  const row = await prisma.appointment.findFirst({ where: { id, tenantId } })
  return row ? toPublic(row) : null
}

export async function createAppointment(
  tenantId: string,
  input: CreateAppointmentInput,
): Promise<AppointmentPublic> {
  const startsAt = new Date(input.starts_at)
  const endsAt = new Date(input.ends_at)

  const overlapping = await prisma.appointment.findFirst({
    where: {
      tenantId,
      staffId: input.staff_id,
      status: { not: 'CANCELLED' },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  })

  if (overlapping) throw new AppointmentOverlapError()

  const row = await prisma.appointment.create({
    data: {
      tenantId,
      customerId: input.customer_id,
      staffId: input.staff_id,
      startsAt,
      endsAt,
      durationMinutes: input.duration_minutes ?? null,
      title: input.title ?? null,
      notes: input.notes ?? null,
      status: input.status ?? 'SCHEDULED',
      source: input.source ?? 'MANUAL',
    },
  })
  return toPublic(row)
}

export async function updateAppointment(
  tenantId: string,
  id: string,
  input: UpdateAppointmentInput,
): Promise<AppointmentPublic> {
  const existing = await prisma.appointment.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error('Appointment not found')

  const data: Record<string, unknown> = {}
  if (input.customer_id !== undefined) data.customerId = input.customer_id
  if (input.staff_id !== undefined) data.staffId = input.staff_id
  if (input.starts_at !== undefined) data.startsAt = new Date(input.starts_at)
  if (input.ends_at !== undefined) data.endsAt = new Date(input.ends_at)
  if (input.duration_minutes !== undefined) data.durationMinutes = input.duration_minutes
  if (input.title !== undefined) data.title = input.title
  if (input.notes !== undefined) data.notes = input.notes
  if (input.status !== undefined) {
    data.status = input.status
    // Cancelling through HTTP clears cancelledAt timestamp appropriately
    if (input.status === 'CANCELLED' && !existing.cancelledAt) {
      data.cancelledAt = new Date()
    } else if (input.status !== 'CANCELLED' && existing.cancelledAt) {
      data.cancelledAt = null
    }
  }

  const row = await prisma.appointment.update({ where: { id }, data })
  return toPublic(row)
}

export async function deleteAppointment(tenantId: string, id: string): Promise<void> {
  const existing = await prisma.appointment.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error('Appointment not found')
  await prisma.appointment.delete({ where: { id } })
}
