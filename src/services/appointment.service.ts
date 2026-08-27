import { prisma } from '../db/client.js'
import { logEventIn, type AuditEventInput } from './audit.service.js'
import { computeBookedPrice } from './pricing.service.js'
import { occupancyFor, InvalidResourceError } from './resource.service.js'
import { Prisma } from '@prisma/client'
import type { Appointment, AppointmentStatus, AppointmentSource, StatusSource } from '@prisma/client'
import { isUniqueViolation, isResourceOverlap } from '../db/prisma-errors.js'
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

/** Lock contention, not a taken slot: the write was refused because it could
 *  not be validated in time (advisory-lock queue timeout or repeated mid-flight
 *  reassignment), so the caller should simply retry — the slot may well be
 *  free. Distinct from AppointmentOverlapError so callers don't tell the
 *  customer "slot taken" when the truth is "try again". */
/** The BED is taken (distinct from the staff-overlap 409): the EXCLUDE
 *  constraint refused the write — Reserve tells the customer WHICH thing is
 *  unavailable instead of guessing. */
export class ResourceTakenError extends Error {
  constructor(message = 'This resource is occupied for the requested time.') {
    super(message)
    this.name = 'ResourceTakenError'
  }
}

export { InvalidResourceError }

export class SlotContentionError extends Error {
  constructor(message = 'Could not validate the slot due to concurrent updates. Retry the request.') {
    super(message)
    this.name = 'SlotContentionError'
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
  menu_id: string | null
  resource_id: string | null
  occupied_until: string | null
  booked_price_amount: number | null
  booked_price_currency: string | null
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
  menuId: string | null
  resourceId: string | null
  occupiedUntil: Date | null
  bookedPriceAmount: number | null
  bookedPriceCurrency: string | null
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
    menu_id: row.menuId,
    resource_id: row.resourceId,
    occupied_until: row.occupiedUntil?.toISOString() ?? null,
    booked_price_amount: row.bookedPriceAmount,
    booked_price_currency: row.bookedPriceCurrency,
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

/** Serialize slot writes per (business, staff): the overlap check and the
 *  write it protects run as check-then-write, so two concurrent requests for
 *  the same free slot could both pass the check and both commit. The advisory
 *  xact lock makes the pair atomic per staff member — it releases on
 *  commit/rollback and (being transaction-scoped) survives pgbouncer
 *  transaction pooling. The QR crawl writes directly via Prisma and is
 *  unaffected; its own dedup is the customer-slot unique index. */
function withStaffSlotLock<T>(
  businessId: string,
  staffId: string,
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma
    .$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${businessId}:${staffId}`}, 0))`
        return fn(tx)
      },
      // The advisory lock waits unboundedly, but Prisma's interactive-transaction
      // defaults (maxWait 2s / timeout 5s) would turn a queue behind one slow
      // writer into a raw P2028 → 500. Give the queue room, and translate the
      // timeout into the retryable contention error instead of a server error.
      { maxWait: 5_000, timeout: 15_000 },
    )
    .catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028') {
        throw new SlotContentionError()
      }
      throw e
    })
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

  // Price of record is decided HERE (Liam item 2): when a menu rides the
  // booking, core recomputes the slot price from the ACTIVE pricing rules.
  // The computed price is the CEILING of what the caller may book — a staff
  // side can still record an agreed discount (the #55 design), but only
  // within [menu floor, computed price]: a client can never inflate the price
  // of record or undercut the band. The lookup also validates the menu
  // belongs to this business (closes #55's unvalidated-menu gap). Menu-less
  // bookings (legacy/free-text) keep the caller's values untouched.
  // Bed claim: validate + snapshot occupancy BEFORE the slot lock (occupied
  // window = ends_at + the resource's cleanup_minutes at write time).
  let occupiedUntil: Date | null = null
  if (input.resource_id) {
    occupiedUntil = await occupancyFor(businessId, input.resource_id, input.store_id ?? null, endsAt)
  }

  let bookedPrice: { amount: number; currency: string } | null = null
  if (input.menu_id) {
    const computed = await computeBookedPrice(
      businessId,
      input.store_id ?? null,
      input.menu_id,
      startsAt,
    )
    if (!computed) throw new Error('Menu not found')
    // Discount clamp: an EXPLICIT band floor binds agreed discounts; a menu
    // without one keeps free-form staff discounts (#55's agreed-price test) —
    // the computed price stays the hard ceiling either way.
    const asked = input.booked_price_amount ?? computed.amount
    bookedPrice = {
      amount: Math.min(computed.amount, Math.max(computed.explicitFloor ?? 0, asked)),
      currency: computed.currency,
    }
  }

  try {
    const row = await withStaffSlotLock(businessId, input.staff_id, async (tx) => {
      const overlapping = await tx.appointment.findFirst({
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
      return tx.appointment.create({
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
          menuId: input.menu_id ?? null,
          resourceId: input.resource_id ?? null,
          occupiedUntil,
          // Menu bookings: server truth (computed above). Menu-less: caller's.
          bookedPriceAmount: bookedPrice ? bookedPrice.amount : (input.booked_price_amount ?? null),
          bookedPriceCurrency: bookedPrice ? bookedPrice.currency : (input.booked_price_currency ?? null),
          status: input.status ?? 'SCHEDULED',
          source: input.source ?? 'MANUAL',
        },
      })
    })
    return toPublic(row)
  } catch (e) {
    if (isUniqueViolation(e, 'starts_at')) throw new CustomerSlotConflictError()
    if (isResourceOverlap(e)) throw new ResourceTakenError()
    throw e
  }
}

export async function updateAppointment(
  businessId: string,
  id: string,
  input: UpdateAppointmentInput,
  /** A1: when supplied, the audit row commits in the SAME transaction as the
   *  booking change — no crash window between action and trail. */
  audit?: AuditEventInput,
): Promise<AppointmentPublic> {
  // Everything data-building needs from the row is read FRESH at write time
  // (see below) — a pre-lock snapshot must never decide slot semantics.
  const buildData = (row: { cancelledAt: Date | null }): Record<string, unknown> => {
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
      if (terminal && !row.cancelledAt) {
        data.cancelledAt = new Date()
      } else if (!terminal && row.cancelledAt) {
        data.cancelledAt = null
      }
    }
    return data
  }

  // Reschedule/reassign guard. createAppointment refuses an overlapping slot,
  // but nothing stopped an UPDATE from moving a booking onto an occupied one —
  // a customer reschedule (SYNQED Reserve) or a calendar drag could silently
  // double-book a staff member. Whether the guard is needed is decided by the
  // INPUT SHAPE (which fields the update touches), never by comparing against
  // a pre-lock snapshot — a stale compare could wave through a write that
  // races another writer on the same row.
  const touchesSlot =
    input.staff_id !== undefined ||
    input.starts_at !== undefined ||
    input.ends_at !== undefined ||
    input.status !== undefined ||
    // A bed change is slot semantics for the BED — route through the slot
    // path so occupied_until recomputes against fresh times.
    input.resource_id !== undefined

  try {
    if (!touchesSlot) {
      // Metadata-only (title/notes/customer/duration label): slot semantics
      // cannot change — no lock. P2002 stays possible via customer_id.
      const existing = await prisma.appointment.findFirst({ where: { id, businessId } })
      if (!existing) throw new Error('Appointment not found')
      const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.appointment.update({ where: { id }, data: buildData(existing) })
        if (audit) await logEventIn(tx, businessId, { ...audit, target_id: audit.target_id ?? id })
        return updated
      })
      return toPublic(row)
    }

    // Slot-touching updates serialize on the TARGET staff — the slot being
    // claimed. With an explicit staff_id the key is exact by construction.
    // Without one, the current staff is read, locked, then RE-READ inside the
    // lock: if a concurrent reassignment moved the row, the key is stale and
    // the attempt retries under the new staff's lock (verifier trace: a
    // reassign + time-change pair could otherwise commit a window never
    // validated against the final staff).
    let lockKey: string
    if (input.staff_id !== undefined) {
      lockKey = input.staff_id
    } else {
      const guess = await prisma.appointment.findFirst({
        where: { id, businessId },
        select: { staffId: true },
      })
      if (!guess) throw new Error('Appointment not found')
      lockKey = guess.staffId
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const out: { row: Appointment } | { retryKey: string } = await withStaffSlotLock(
        businessId,
        lockKey,
        async (tx) => {
        // FOR UPDATE, not a plain SELECT: two writers to the SAME row under
        // DIFFERENT advisory keys (reassign racing a time-change) never meet
        // on an advisory lock — the row lock is what serializes them. The
        // second writer blocks here until the first commits, reads the
        // committed row, and the key-mismatch retry below handles the rest.
        // Advisory lock is always taken before the row lock, so wait chains
        // stay linear (no deadlock cycle).
        const freshRows = await tx.$queryRaw<
          Array<{
            staff_id: string
            store_id: string | null
            status: AppointmentStatus
            starts_at: Date
            ends_at: Date
            cancelled_at: Date | null
            resource_id: string | null
            occupied_until: Date | null
          }>
        >`SELECT staff_id, store_id, status, starts_at, ends_at, cancelled_at, resource_id, occupied_until
          FROM appointments
          WHERE id = ${id}::uuid AND business_id = ${businessId}::uuid
          FOR UPDATE`
        const fresh = freshRows[0]
          ? {
              staffId: freshRows[0].staff_id,
              storeId: freshRows[0].store_id,
              status: freshRows[0].status,
              startsAt: freshRows[0].starts_at,
              endsAt: freshRows[0].ends_at,
              cancelledAt: freshRows[0].cancelled_at,
              resourceId: freshRows[0].resource_id,
              occupiedUntil: freshRows[0].occupied_until,
            }
          : null
        if (!fresh) throw new Error('Appointment not found')
        const effStaffId = input.staff_id ?? fresh.staffId
        if (effStaffId !== lockKey) return { retryKey: effStaffId }

        const effStartsAt =
          input.starts_at !== undefined ? new Date(input.starts_at) : fresh.startsAt
        const effEndsAt = input.ends_at !== undefined ? new Date(input.ends_at) : fresh.endsAt
        // A single-field time update can invert the window (starts_at moved past
        // the existing ends_at): the overlap predicate can never match an
        // inverted range, so it would slip through the guard AND be invisible to
        // every future overlap query. Reject before it can persist — but only
        // when this update touches the times: a plain cancel of a legacy row
        // that is ALREADY inverted (pre-fix API) must not 400 on other fields.
        if (
          (input.starts_at !== undefined || input.ends_at !== undefined) &&
          effEndsAt.getTime() <= effStartsAt.getTime()
        ) {
          throw new InvalidTimeRangeError()
        }
        const effStatus = input.status ?? fresh.status
        const wasTerminal = fresh.status === 'CANCELLED' || fresh.status === 'NO_SHOW'
        const staysActive = effStatus !== 'CANCELLED' && effStatus !== 'NO_SHOW'
        const slotChanged =
          effStaffId !== fresh.staffId ||
          effStartsAt.getTime() !== fresh.startsAt.getTime() ||
          effEndsAt.getTime() !== fresh.endsAt.getTime()

        if (staysActive && (slotChanged || wasTerminal)) {
          const overlapping = await tx.appointment.findFirst({
            where: {
              businessId,
              staffId: effStaffId,
              // update can't move a booking between stores (no store_id in the
              // schema), so the store scope is the existing row's — same
              // per-store conflict semantics as create.
              storeId: fresh.storeId,
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
              id: { not: id },
              startsAt: { lt: effEndsAt },
              endsAt: { gt: effStartsAt },
            },
            select: { id: true },
          })
          if (overlapping) throw new AppointmentOverlapError()
        }

        // Bed recompute: effective resource = explicit change or the row's own;
        // occupied_until always = eff ends + that resource's cleanup snapshot.
        const effResourceId =
          input.resource_id !== undefined ? input.resource_id : fresh.resourceId
        const resourcePatch: Record<string, unknown> = {}
        if (input.resource_id !== undefined) resourcePatch.resourceId = input.resource_id
        if (input.resource_id && input.resource_id !== fresh.resourceId) {
          // NEW claim: full validation (business + active + store required).
          // Same-id resubmission (idempotent full-state PUT) is NOT a new
          // claim — it falls through to recompute, so a retired bed never
          // blocks lifecycle updates that merely restate it (Greptile r2).
          resourcePatch.occupiedUntil = await occupancyFor(
            businessId,
            input.resource_id,
            fresh.storeId,
            effEndsAt,
          )
        } else if (effResourceId) {
          // Unchanged existing claim: carry the row's ORIGINAL cleanup delta
          // (occupied_until − ends_at) onto the new end — never re-read the
          // resource's CURRENT cleanup config (Greptile r5: a config change
          // must not silently move when a booked bed frees, nor make an
          // unrelated lifecycle update conflict). Also never blocks on a
          // retired bed (r1) — no resource lookup happens at all.
          const cleanupMs = fresh.occupiedUntil
            ? Math.max(0, fresh.occupiedUntil.getTime() - fresh.endsAt.getTime())
            : 0
          resourcePatch.occupiedUntil = new Date(effEndsAt.getTime() + cleanupMs)
        } else if (input.resource_id === null) {
          resourcePatch.occupiedUntil = null
        }
        const updated = await tx.appointment.update({
          where: { id },
          data: { ...buildData(fresh), ...resourcePatch },
        })
        if (audit) await logEventIn(tx, businessId, { ...audit, target_id: audit.target_id ?? id })
        return { row: updated }
      })
      if ('row' in out) return toPublic(out.row)
      lockKey = out.retryKey
    }
    // 3 consecutive mid-flight reassignments — practically unreachable; fail
    // closed and ask the caller to retry rather than writing unvalidated.
    throw new SlotContentionError()
  } catch (e) {
    // Same DB backstop as create: the partial unique index on
    // (business_id, customer_id, starts_at) also fires on UPDATE — without
    // this catch a same-customer collision surfaced as a raw P2002 → 500.
    if (isUniqueViolation(e, 'starts_at')) throw new CustomerSlotConflictError()
    if (isResourceOverlap(e)) throw new ResourceTakenError()
    throw e
  }
}

export async function deleteAppointment(businessId: string, id: string): Promise<void> {
  const existing = await prisma.appointment.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Appointment not found')
  await prisma.appointment.delete({ where: { id } })
}
