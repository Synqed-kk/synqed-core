import { prisma } from '../db/client.js'
import type { AppointmentStatus, AppointmentSource, StatusSource } from '@prisma/client'
import { isUniqueViolation } from '../db/prisma-errors.js'
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

export class InvalidTimeRangeError extends Error {
  constructor(message = 'ends_at must be after starts_at.') {
    super(message)
    this.name = 'InvalidTimeRangeError'
  }
}

export class CustomerSlotConflictError extends Error {
  constructor(message = 'This customer already has a booking at this time.') {
    super(message)
    this.name = 'CustomerSlotConflictError'
  }
}

export interface AppointmentPublic {
  id: string
  business_id: string
  customer_id: string
  staff_id: string
  store_id: string | null
  starts_at: string
  ends_at: string
  duration_minutes: number | null
  title: string | null
  notes: string | null
  status: AppointmentStatus
  source: AppointmentSource
  external_refs: unknown
  cancelled_at: string | null
  status_source: StatusSource
  status_set_by: string | null
  status_reason: string | null
  status_set_at: string | null
  created_at: string
  updated_at: string
}

function toPublic(row: {
  id: string
  businessId: string
  customerId: string
  staffId: string
  storeId: string | null
  startsAt: Date
  endsAt: Date
  durationMinutes: number | null
  title: string | null
  notes: string | null
  status: AppointmentStatus
  source: AppointmentSource
  externalRefs: unknown
  cancelledAt: Date | null
  statusSource: StatusSource
  statusSetBy: string | null
  statusReason: string | null
  statusSetAt: Date | null
  createdAt: Date
  updatedAt: Date
}): AppointmentPublic {
  return {
    id: row.id,
    business_id: row.businessId,
    customer_id: row.customerId,
    staff_id: row.staffId,
    store_id: row.storeId,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    duration_minutes: row.durationMinutes,
    title: row.title,
    notes: row.notes,
    status: row.status,
    source: row.source,
    external_refs: row.externalRefs,
    cancelled_at: row.cancelledAt?.toISOString() ?? null,
    status_source: row.statusSource,
    status_set_by: row.statusSetBy,
    status_reason: row.statusReason,
    status_set_at: row.statusSetAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listAppointments(
  businessId: string,
  options: {
    from?: string
    to?: string
    store_id?: string
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

  const where: Record<string, unknown> = { businessId }
  if (options.store_id) where.storeId = options.store_id
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
  businessId: string,
  id: string,
): Promise<AppointmentPublic | null> {
  const row = await prisma.appointment.findFirst({ where: { id, businessId } })
  return row ? toPublic(row) : null
}

export async function createAppointment(
  businessId: string,
  input: CreateAppointmentInput,
): Promise<AppointmentPublic> {
  const startsAt = new Date(input.starts_at)
  const endsAt = new Date(input.ends_at)
  // Same inverted-window rejection as update — an inverted range slips every
  // overlap predicate (nothing can satisfy lt/gt both ways) and persists garbage.
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new InvalidTimeRangeError()
  }

  const overlapping = await prisma.appointment.findFirst({
    where: {
      businessId,
      staffId: input.staff_id,
      // Per-store: a staff double-booking is only a conflict within the same
      // location. null-store bookings conflict only with other null-store ones.
      storeId: input.store_id ?? null,
      // A terminal booking (cancelled or no-show) frees the slot — the customer
      // isn't coming, so it must be rebookable.
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  })

  if (overlapping) throw new AppointmentOverlapError()

  // A customer can't be in two chairs at once: UNIQUE(business_id, customer_id,
  // starts_at) enforces one booking per customer per instant (and is what lets
  // the QR crawl adopt a manual row instead of twinning it — see sync.service).
  // The per-staff overlap check above can't catch a same-customer/same-time
  // booking under a DIFFERENT staff, so the DB constraint is the backstop.
  // Surface that collision as a clean 409 rather than a raw P2002 → 500.
  try {
    const row = await prisma.appointment.create({
      data: {
        businessId,
        customerId: input.customer_id,
        staffId: input.staff_id,
        storeId: input.store_id ?? null,
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
  } catch (e) {
    if (isUniqueViolation(e, 'starts_at')) throw new CustomerSlotConflictError()
    throw e
  }
}

export async function updateAppointment(
  businessId: string,
  id: string,
  input: UpdateAppointmentInput,
): Promise<AppointmentPublic> {
  const existing = await prisma.appointment.findFirst({ where: { id, businessId } })
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
    // A status change through the app is a staff decision — stamp the audit
    // trail (who/why/when) and mark statusSource=STAFF so the QuickReserve crawl
    // won't overwrite it (see sync.service stripStaffLockedStatus).
    data.statusSource = 'STAFF'
    data.statusSetBy = input.acting_staff_id ?? null
    data.statusReason = input.status_reason ?? null
    data.statusSetAt = new Date()
    const terminal = input.status === 'CANCELLED' || input.status === 'NO_SHOW'
    if (terminal && !existing.cancelledAt) {
      data.cancelledAt = new Date()
    } else if (!terminal && existing.cancelledAt) {
      data.cancelledAt = null
    }
  }

  // Reschedule/reassign guard. createAppointment refuses an overlapping slot,
  // but nothing stopped an UPDATE from moving a booking onto an occupied one —
  // a customer reschedule (SYNQED Reserve) or a calendar drag could silently
  // double-book a staff member. Same per-staff/per-store window query as
  // create, excluding self; runs only when the update changes the occupied
  // slot (time/staff) or revives a terminal booking into one.
  const effStaffId = input.staff_id ?? existing.staffId
  const effStartsAt = input.starts_at !== undefined ? new Date(input.starts_at) : existing.startsAt
  const effEndsAt = input.ends_at !== undefined ? new Date(input.ends_at) : existing.endsAt
  // A single-field time update can invert the window (starts_at moved past the
  // existing ends_at): the overlap predicate can never match an inverted range,
  // so it would slip through the guard AND be invisible to every future
  // overlap query. Reject before it can persist — but only when this update
  // touches the times: a notes-only edit or a plain cancel of a legacy row
  // that is ALREADY inverted (pre-fix API) must not 400 on unrelated fields.
  if (
    (input.starts_at !== undefined || input.ends_at !== undefined) &&
    effEndsAt.getTime() <= effStartsAt.getTime()
  ) {
    throw new InvalidTimeRangeError()
  }
  const effStatus = input.status ?? existing.status
  const wasTerminal = existing.status === 'CANCELLED' || existing.status === 'NO_SHOW'
  const staysActive = effStatus !== 'CANCELLED' && effStatus !== 'NO_SHOW'
  const slotChanged =
    effStaffId !== existing.staffId ||
    effStartsAt.getTime() !== existing.startsAt.getTime() ||
    effEndsAt.getTime() !== existing.endsAt.getTime()

  if (staysActive && (slotChanged || wasTerminal)) {
    const overlapping = await prisma.appointment.findFirst({
      where: {
        businessId,
        staffId: effStaffId,
        // update can't move a booking between stores (no store_id in the
        // schema), so the store scope is the existing row's — same per-store
        // conflict semantics as create.
        storeId: existing.storeId,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        id: { not: id },
        startsAt: { lt: effEndsAt },
        endsAt: { gt: effStartsAt },
      },
      select: { id: true },
    })
    if (overlapping) throw new AppointmentOverlapError()
  }

  // Same DB backstop as create: the partial unique index on
  // (business_id, customer_id, starts_at) also fires on UPDATE — without this
  // catch a same-customer collision surfaced as a raw P2002 → 500.
  try {
    const row = await prisma.appointment.update({ where: { id }, data })
    return toPublic(row)
  } catch (e) {
    if (isUniqueViolation(e, 'starts_at')) throw new CustomerSlotConflictError()
    throw e
  }
}

export async function deleteAppointment(businessId: string, id: string): Promise<void> {
  const existing = await prisma.appointment.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Appointment not found')
  await prisma.appointment.delete({ where: { id } })
}
