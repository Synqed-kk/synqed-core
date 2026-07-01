import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import * as inviteService from '../services/invite.service.js'

export const inviteRoutes = new Hono<AppEnv>()

inviteRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  return c.json({ invites: await inviteService.listInvites(businessId) })
})

// Public (API-key-gated, NO business scope) — validate an invite token for the
// pre-auth /join page. The token is the secret; the response carries business_id.
inviteRoutes.get('/by-token/:token', async (c) => {
  const invite = await inviteService.getInviteByToken(c.req.param('token'))
  if (!invite) return c.json({ error: 'Invite not found' }, 404)
  return c.json(invite)
})

inviteRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.email !== 'string' || typeof b.role !== 'string' || typeof b.token !== 'string') {
    return c.json({ error: 'email, role, token required' }, 400)
  }
  const invite = await inviteService.createInvite(businessId, {
    email: b.email,
    role: b.role,
    token: b.token,
    invited_by: typeof b.invited_by === 'string' ? b.invited_by : null,
    invited_staff_id: typeof b.invited_staff_id === 'string' ? b.invited_staff_id : null,
    expires_at: typeof b.expires_at === 'string' ? b.expires_at : null,
  })
  return c.json(invite, 201)
})

inviteRoutes.patch('/:id', async (c) => {
  const businessId = c.get('businessId')
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.status !== 'string') return c.json({ error: 'status required' }, 400)
  try {
    return c.json(await inviteService.updateInviteStatus(businessId, c.req.param('id'), b.status))
  } catch {
    return c.json({ error: 'Invite not found' }, 404)
  }
})
