import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  listAppointmentsSchema,
} from '../validations/appointment.js'
import * as appointmentService from '../services/appointment.service.js'
import { AppointmentOverlapError } from '../services/appointment.service.js'

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
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const appointment = await appointmentService.createAppointment(businessId, parsed.data)
    return c.json(appointment, 201)
  } catch (err) {
    if (err instanceof AppointmentOverlapError) {
      return c.json({ error: err.message }, 409)
    }
    throw err
  }
})

appointmentRoutes.put('/:id', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateAppointmentSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  try {
    const appointment = await appointmentService.updateAppointment(
      businessId,
      c.req.param('id'),
      parsed.data,
    )
    return c.json(appointment)
  } catch (err) {
    if (err instanceof Error && err.message === 'Appointment not found') {
      return c.json({ error: 'Appointment not found' }, 404)
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
