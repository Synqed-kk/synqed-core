import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import {
  createStaffSchema,
  updateStaffSchema,
  listStaffSchema,
  setPinSchema,
  verifyPinSchema,
} from '../validations/staff.js'
import * as staffService from '../services/staff.service.js'
import { StaffLastMemberError, StaffAttributedRecordsError } from '../services/staff.service.js'

export const staffRoutes = new Hono<AppEnv>()

staffRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listStaffSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await staffService.listStaff(tenantId, parsed.data)
  return c.json(result)
})

staffRoutes.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const staff = await staffService.getStaff(tenantId, c.req.param('id'))
  if (!staff) return c.json({ error: 'Staff not found' }, 404)
  return c.json(staff)
})

staffRoutes.post('/', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createStaffSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const staff = await staffService.createStaff(tenantId, parsed.data)
  return c.json(staff, 201)
})

staffRoutes.put('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateStaffSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  try {
    const staff = await staffService.updateStaff(tenantId, c.req.param('id'), parsed.data)
    return c.json(staff)
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: 'Staff not found' }, 404)
    }
    throw err
  }
})

staffRoutes.delete('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  try {
    await staffService.deleteStaff(tenantId, c.req.param('id'))
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: 'Staff not found' }, 404)
    }
    if (err instanceof StaffLastMemberError || err instanceof StaffAttributedRecordsError) {
      return c.json({ error: err.message }, 400)
    }
    throw err
  }
})

staffRoutes.put('/:id/pin', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = setPinSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    await staffService.setPin(tenantId, id, parsed.data.pin)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: 'Staff not found' }, 404)
    }
    throw err
  }
})

staffRoutes.delete('/:id/pin', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  try {
    await staffService.removePin(tenantId, id)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: 'Staff not found' }, 404)
    }
    throw err
  }
})

staffRoutes.post('/:id/pin/verify', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = verifyPinSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const result = await staffService.verifyPin(tenantId, id, parsed.data.pin)
    return c.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: 'Staff not found' }, 404)
    }
    throw err
  }
})

staffRoutes.get('/:id/pin', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  try {
    const result = await staffService.hasPin(tenantId, id)
    return c.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: 'Staff not found' }, 404)
    }
    throw err
  }
})

staffRoutes.post('/:id/avatar', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const formData = await c.req.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)

  try {
    const result = await staffService.uploadAvatar(tenantId, id, file)
    return c.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})
