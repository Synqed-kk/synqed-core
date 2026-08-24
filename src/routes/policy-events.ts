import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/api.js'
import * as policyEvents from '../services/policy-event.service.js'

export const policyEventRoutes = new Hono<AppEnv>()

const recordSchema = z.object({
  staff_id: z.string().uuid(),
  policy_line: z.string().min(1).max(100),
  policy_version: z.number().int().min(1),
  event: z.enum(['delivered', 'acknowledged', 'revoked']),
})

// Append a policy event (no update/delete surface — append-only by design).
policyEventRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = recordSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    return c.json(await policyEvents.recordEvent(businessId, parsed.data), 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// Queryable lenses: per staff, per line/version, per event kind.
policyEventRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const q = c.req.query()
  if (q.event !== undefined && !['delivered', 'acknowledged', 'revoked'].includes(q.event)) {
    return c.json({ error: 'event must be delivered|acknowledged|revoked' }, 400)
  }
  const version = q.policy_version !== undefined ? Number(q.policy_version) : undefined
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    return c.json({ error: 'policy_version must be a positive integer' }, 400)
  }
  return c.json(
    await policyEvents.listEvents(businessId, {
      staff_id: q.staff_id,
      policy_line: q.policy_line,
      policy_version: version,
      event: q.event as 'delivered' | 'acknowledged' | 'revoked' | undefined,
    }),
  )
})

// The enablement check: "has this person acknowledged version N of line L".
policyEventRoutes.get('/ack-state', async (c) => {
  const businessId = c.get('businessId')
  const q = c.req.query()
  const version = Number(q.policy_version)
  if (!q.staff_id || !q.policy_line || !Number.isInteger(version) || version < 1) {
    return c.json({ error: 'staff_id, policy_line, policy_version required' }, 400)
  }
  return c.json(await policyEvents.ackState(businessId, q.staff_id, q.policy_line, version))
})
