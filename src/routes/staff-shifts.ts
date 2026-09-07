import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import { actorAuthMiddleware } from '../middleware/actor-auth.js'
import { createStaffShiftSchema, updateStaffShiftSchema, listStaffShiftsSchema } from '../validations/staff-shift.js'
import * as shifts from '../services/staff-shift.service.js'

export const staffShiftRoutes = new Hono<AppEnv>()

staffShiftRoutes.onError((err, c) => {
  if (err instanceof shifts.StaffShiftError) return c.json({ error: err.message }, err.status)
  throw err
})
staffShiftRoutes.use('/:id', async (c, next) => {
  if (!z.string().uuid().safeParse(c.req.param('id')).success) return c.json({ error: 'Invalid shift ID' }, 400)
  await next()
})
staffShiftRoutes.get('/', async c => {
  const parsed = listStaffShiftsSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  return c.json(await shifts.listStaffShifts(c.get('businessId'), parsed.data))
})
staffShiftRoutes.get('/:id', async c => c.json(await shifts.getStaffShift(c.get('businessId'), c.req.param('id'))))
staffShiftRoutes.post('/', actorAuthMiddleware, async c => {
  const parsed = createStaffShiftSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  return c.json(await shifts.createStaffShift(c.get('businessId'), parsed.data, c.get('actor')), 201)
})
staffShiftRoutes.put('/:id', actorAuthMiddleware, async c => {
  const parsed = updateStaffShiftSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  return c.json(await shifts.updateStaffShift(c.get('businessId'), c.req.param('id'), parsed.data, c.get('actor')))
})
staffShiftRoutes.delete('/:id', actorAuthMiddleware, async c => {
  await shifts.deleteStaffShift(c.get('businessId'), c.req.param('id'), c.get('actor'))
  return c.json({ success: true })
})
