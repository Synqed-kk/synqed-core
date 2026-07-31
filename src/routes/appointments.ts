import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  listAppointmentsSchema,
} from '../validations/appointment.js'
import * as appointmentService from '../services/appointment.service.js'
import * as idempotencyService from '../services/idempotency.service.js'
import { auditEventSchema } from '../validations/audit.js'
import {
  AppointmentOverlapError,
  CustomerSlotConflictError,
  InvalidTimeRangeError,
  SlotContentionError,
} from '../services/appointment.service.js'

export const appointmentRoutes = new Hono<AppEnv>()

appointmentRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listAppointmentsSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await appointmentService.listAppointments(businessId, parsed.data)
  return c.json(result)
})

appointmentRoutes.get('/:id', async (c) => {
  const businessId = c.get('businessId')
  const appointment = await appointmentService.getAppointment(businessId, c.req.param('id'))
  if (!appointment) return c.json({ error: 'Appointment not found' }, 404)
  return c.json(appointment)
})

appointmentRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createAppointmentSchema.safeParse(body)
  // Validation runs before the key is claimed: a 400 never consumes the key.
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  // Idempotency-Key dedup: a retried create with the same key replays the
  // appointment the first attempt made instead of double-booking (claim →
  // create → complete; see idempotency.service.ts for the race protocol).
  const idemKey = c.req.header('Idempotency-Key')
  let claimId: string | null = null
  if (idemKey) {
    const claim = await idempotencyService.claimKey(businessId, idemKey)
    if (claim.kind === 'replay') {
      const existing = await appointmentService.getAppointment(businessId, claim.appointmentId)
      if (existing) return c.json(existing, 200)
      return c.json(
        { error: 'The appointment created under this Idempotency-Key no longer exists.', code: 'IDEMPOTENT_REPLAY_GONE' },
        409,
      )
    }
    if (claim.kind === 'in_flight') {
      return c.json(
        { error: 'The original request with this Idempotency-Key is still in progress. Retry.', code: 'IDEMPOTENT_IN_FLIGHT' },
        503,
        { 'Retry-After': '1' },
      )
    }
    claimId = claim.claimId
  }

  try {
    const appointment = await appointmentService.createAppointment(businessId, parsed.data)
    if (claimId) await idempotencyService.completeKey(claimId, appointment.id)
    return c.json(appointment, 201)
  } catch (err) {
    // A failed create must not poison the key — release so a retry can run.
    if (claimId) await idempotencyService.releaseKey(claimId).catch(() => {})
    if (err instanceof AppointmentOverlapError || err instanceof CustomerSlotConflictError) {
      return c.json({ error: err.message }, 409)
    }
    if (err instanceof InvalidTimeRangeError) {
      return c.json({ error: err.message }, 400)
    }
    if (err instanceof SlotContentionError) {
      // Retryable — not a taken slot. 503 + Retry-After keeps it distinct from
      // the 409 that callers surface to customers as SLOT_TAKEN.
      return c.json({ error: err.message, code: 'SLOT_CONTENTION' }, 503, { 'Retry-After': '1' })
    }
    if (err instanceof Error && err.message === 'Menu not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

appointmentRoutes.put('/:id', async (c) => {
  const businessId = c.get('businessId')
  const { audit: rawAudit, ...body } = await c.req.json().catch(() => ({}))
  const parsed = updateAppointmentSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  // A1: optional audit payload commits atomically with the update.
  let audit
  if (rawAudit !== undefined) {
    const parsedAudit = auditEventSchema.safeParse(rawAudit)
    if (!parsedAudit.success) return c.json({ error: parsedAudit.error.issues[0].message }, 400)
    audit = parsedAudit.data
  }

  try {
    const appointment = await appointmentService.updateAppointment(
      businessId,
      c.req.param('id'),
      parsed.data,
      audit,
    )
    return c.json(appointment)
  } catch (err) {
    if (err instanceof Error && err.message === 'Appointment not found') {
      return c.json({ error: 'Appointment not found' }, 404)
    }
    if (err instanceof AppointmentOverlapError || err instanceof CustomerSlotConflictError) {
      return c.json({ error: err.message }, 409)
    }
    if (err instanceof InvalidTimeRangeError) {
      return c.json({ error: err.message }, 400)
    }
    if (err instanceof SlotContentionError) {
      return c.json({ error: err.message, code: 'SLOT_CONTENTION' }, 503, { 'Retry-After': '1' })
    }
    throw err
  }
})

appointmentRoutes.delete('/:id', async (c) => {
  const businessId = c.get('businessId')
  try {
    await appointmentService.deleteAppointment(businessId, c.req.param('id'))
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Appointment not found') {
      return c.json({ error: 'Appointment not found' }, 404)
    }
    throw err
  }
})
