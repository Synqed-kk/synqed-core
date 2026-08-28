import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as qualificationService from '../services/qualification.service.js'
import { QualificationNameTakenError } from '../services/qualification.service.js'

export const qualificationRoutes = new Hono<AppEnv>()

// NOT z.coerce.boolean(): Boolean("false") === true — parse explicitly.
const queryBool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional()

const createSchema = z.object({ name: z.string().min(1).max(200) }).strict()
const updateSchema = z
  .object({ name: z.string().min(1).max(200).optional(), active: z.boolean().optional() })
  .strict()

// Literal '/staff' routes registered before the '/:id' param route.

// Every staff→qualification link in one call (the board's bulk read).
qualificationRoutes.get('/staff', async (c) => {
  const businessId = c.get('businessId')
  const assignments = await qualificationService.getAllStaffQualifications(businessId)
  return c.json({ assignments })
})

// The qualification ids one staff member holds.
qualificationRoutes.get('/staff/:staffId', async (c) => {
  const businessId = c.get('businessId')
  const ids = await qualificationService.getStaffQualifications(businessId, c.req.param('staffId'))
  return c.json({ qualification_ids: ids })
})

// Replace a staff member's full qualification set (staff-stores semantics).
qualificationRoutes.put('/staff/:staffId', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const ids = Array.isArray(body.qualification_ids)
    ? body.qualification_ids.filter((s: unknown): s is string => typeof s === 'string')
    : []
  try {
    await qualificationService.setStaffQualifications(businessId, c.req.param('staffId'), ids)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed' }, 400)
  }
})

qualificationRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const parsed = z
    .object({ active: queryBool })
    .safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const qualifications = await qualificationService.listQualifications(businessId, parsed.data)
  return c.json({ qualifications })
})

qualificationRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const qualification = await qualificationService.createQualification(businessId, parsed.data)
    return c.json(qualification, 201)
  } catch (err) {
    if (err instanceof QualificationNameTakenError) return c.json({ error: err.message }, 409)
    throw err
  }
})

// PATCH: rename / retire (active:false). No DELETE — menus reference these.
qualificationRoutes.patch('/:id', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const qualification = await qualificationService.updateQualification(
      businessId,
      c.req.param('id'),
      parsed.data,
    )
    if (!qualification) return c.json({ error: 'Qualification not found' }, 404)
    return c.json(qualification)
  } catch (err) {
    if (err instanceof QualificationNameTakenError) return c.json({ error: err.message }, 409)
    throw err
  }
})
