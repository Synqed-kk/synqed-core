import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as permissionService from '../services/permission.service.js'
import { InvalidPermissionError } from '../services/permission.service.js'
import { PERMISSION_ROLES } from '../services/permission-rulebook.js'
import { requireHqAdmin, NotHqAdminError } from '../services/business-grant.service.js'
import { auditEventSchema } from '../validations/audit.js'

export const permissionRoutes = new Hono<AppEnv>()

// The rulebook — one source for both apps' toggle UIs.
permissionRoutes.get('/rulebook', async (c) => {
  return c.json(permissionService.rulebook())
})

// The answer sheet: rights + visible stores + version, server-computed.
permissionRoutes.get('/answer-sheet', async (c) => {
  const businessId = c.get('businessId')
  const staffId = c.req.query('staff_id')
  if (!staffId) return c.json({ error: 'staff_id required' }, 400)
  const sheet = await permissionService.answerSheet(businessId, staffId)
  if (!sheet) return c.json({ error: 'Staff not found or inactive' }, 404)
  return c.json(sheet)
})

// Roster admin read: every staff member's assignment (explicit or derived).
permissionRoutes.get('/staff', async (c) => {
  const businessId = c.get('businessId')
  return c.json(await permissionService.listAssignments(businessId))
})

const setSchema = z.object({
  role: z.enum(PERMISSION_ROLES),
  overrides: z.array(z.string()).nullable().optional(),
  assigned_store_ids: z.array(z.string().uuid()).max(50).optional(),
  acting_staff_id: z.string().uuid(),
  audit: auditEventSchema.optional(),
})

// HQ-gated assignment write; version bumps in the same transaction.
permissionRoutes.put('/staff/:staffId', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = setSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const { acting_staff_id, audit, ...input } = parsed.data
  try {
    await requireHqAdmin(businessId, acting_staff_id)
    const saved = await permissionService.setAssignment(
      businessId,
      c.req.param('staffId'),
      { ...input, updated_by: acting_staff_id },
      audit,
    )
    return c.json(saved)
  } catch (err) {
    if (err instanceof NotHqAdminError) return c.json({ error: err.message }, 403)
    if (err instanceof InvalidPermissionError) return c.json({ error: err.message }, 400)
    throw err
  }
})
