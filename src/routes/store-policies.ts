import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as policyService from '../services/store-policy.service.js'
import { requireHqAdmin, NotHqAdminError } from '../services/business-grant.service.js'
import { auditEventSchema } from '../validations/audit.js'

export const storePolicyRoutes = new Hono<AppEnv>()

// "HH:MM" 24h. String compare is chronological for this shape, so open<close
// is a plain refine.
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/
const dayWindowSchema = z
  .object({ open: z.string().regex(timeRe), close: z.string().regex(timeRe) })
  .strict()
  .refine((w) => w.open < w.close, { message: 'open must be before close' })
  .nullable()
// A null/absent weekday = 定休日; the whole value null = clear back to
// unconfigured.
const weeklyHoursSchema = z
  .object({
    mon: dayWindowSchema.optional(),
    tue: dayWindowSchema.optional(),
    wed: dayWindowSchema.optional(),
    thu: dayWindowSchema.optional(),
    fri: dayWindowSchema.optional(),
    sat: dayWindowSchema.optional(),
    sun: dayWindowSchema.optional(),
  })
  .strict()
  .nullable()

const setSchema = z.object({
  booking_open_days: z.number().int().min(1).max(365).optional(),
  cutoff_minutes: z.number().int().min(0).max(10080).optional(),
  cancel_free_until_hours: z.number().int().min(0).max(720).optional(),
  cancel_late_pct: z.number().int().min(0).max(100).optional(),
  no_show_pct: z.number().int().min(0).max(100).optional(),
  gap_guard_mode: z.enum(['OFF', 'STANDARD', 'STRICT']).optional(),
  new_client_session_minutes: z.union([z.literal(60), z.literal(75), z.literal(90)]).optional(),
  weekly_hours: weeklyHoursSchema.optional(),
  acting_staff_id: z.string().uuid(),
  audit: auditEventSchema.optional(),
})

// Shape AND calendar validity: the regex alone accepts 2026-02-30, which
// new Date() silently normalizes to another day — the round-trip check
// rejects it instead.
const dateRe = /^\d{4}-\d{2}-\d{2}$/
const calendarDate = z
  .string()
  .regex(dateRe, 'date must be YYYY-MM-DD')
  .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, {
    message: 'date is not a real calendar date',
  })
const addClosedDaySchema = z.object({
  date: calendarDate,
  reason: z.string().max(500).nullable().optional(),
  acting_staff_id: z.string().uuid(),
  audit: auditEventSchema.optional(),
})

// Effective policies for every store (dashboard settings page).
storePolicyRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  return c.json({ policies: await policyService.listPolicies(businessId) })
})

// Ad-hoc closed days (臨時休業) for one store, optionally ?from=&to= (YYYY-MM-DD,
// to exclusive). Registered before the bare '/:storeId' param routes.
storePolicyRoutes.get('/:storeId/closed-days', async (c) => {
  const businessId = c.get('businessId')
  const q = Object.fromEntries(new URL(c.req.url).searchParams)
  const range = z
    .object({ from: calendarDate.optional(), to: calendarDate.optional() })
    .safeParse(q)
  if (!range.success) return c.json({ error: range.error.issues[0].message }, 400)
  const days = await policyService.listClosedDays(businessId, c.req.param('storeId'), range.data)
  if (days === null) return c.json({ error: 'Store not found' }, 404)
  return c.json({ closed_days: days })
})

// HQ-gated add; UNIQUE(store, date) → 409.
storePolicyRoutes.post('/:storeId/closed-days', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = addClosedDaySchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const { acting_staff_id, audit, ...fields } = parsed.data
  try {
    await requireHqAdmin(businessId, acting_staff_id)
    const day = await policyService.addClosedDay(
      businessId,
      c.req.param('storeId'),
      { ...fields, created_by: acting_staff_id },
      audit,
    )
    if (!day) return c.json({ error: 'Store not found' }, 404)
    return c.json(day, 201)
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    if (err instanceof policyService.ClosedDayExistsError) return c.json({ error: err.message }, 409)
    throw err
  }
})

// HQ-gated remove. acting_staff_id rides the query string (DELETE body is
// unreliable across clients).
storePolicyRoutes.delete('/:storeId/closed-days/:id', async (c) => {
  const businessId = c.get('businessId')
  const actingStaffId = new URL(c.req.url).searchParams.get('acting_staff_id')
  if (!actingStaffId || !z.string().uuid().safeParse(actingStaffId).success) {
    return c.json({ error: 'acting_staff_id (uuid) query param is required' }, 400)
  }
  try {
    await requireHqAdmin(businessId, actingStaffId)
    const removed = await policyService.removeClosedDay(
      businessId,
      c.req.param('storeId'),
      c.req.param('id'),
    )
    if (!removed) return c.json({ error: 'Closed day not found' }, 404)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    throw err
  }
})

// One store's effective policy (the BFF's calendar read).
storePolicyRoutes.get('/:storeId', async (c) => {
  const businessId = c.get('businessId')
  const policy = await policyService.getPolicy(businessId, c.req.param('storeId'))
  if (!policy) return c.json({ error: 'Store not found' }, 404)
  return c.json(policy)
})

// HQ-gated upsert; partial — omitted fields keep current values.
storePolicyRoutes.put('/:storeId', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = setSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const { acting_staff_id, audit, ...fields } = parsed.data
  try {
    await requireHqAdmin(businessId, acting_staff_id)
    const policy = await policyService.setPolicy(
      businessId,
      c.req.param('storeId'),
      { ...fields, updated_by: acting_staff_id },
      audit,
    )
    if (!policy) return c.json({ error: 'Store not found' }, 404)
    return c.json(policy)
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    throw err
  }
})
