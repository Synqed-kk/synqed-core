import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import * as packs from '../services/packs.service.js'

export const packRoutes = new Hono<AppEnv>()

// ─── ticket_packs ────────────────────────────────────────────────────────────

packRoutes.get('/active', async (c) => {
  return c.json({ packs: await packs.listActivePacks(c.get('businessId')) })
})

packRoutes.get('/', async (c) => {
  const customerId = c.req.query('customer_id')
  if (!customerId) return c.json({ error: 'customer_id required' }, 400)
  return c.json({ packs: await packs.listPacksByCustomer(c.get('businessId'), customerId) })
})

packRoutes.post('/', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.customer_id !== 'string' || typeof b.kind !== 'string') {
    return c.json({ error: 'customer_id and kind required' }, 400)
  }
  const pack = await packs.createPack(c.get('businessId'), b)
  return c.json(pack, 201)
})

packRoutes.patch('/:id/status', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.status !== 'string') return c.json({ error: 'status required' }, 400)
  return c.json(await packs.updatePackStatus(c.get('businessId'), c.req.param('id'), b.status))
})

// ─── pack_redemptions ────────────────────────────────────────────────────────

packRoutes.get('/redemptions/pack-ids', async (c) => {
  return c.json({ pack_ids: await packs.listAllRedemptionPackIds(c.get('businessId')) })
})

packRoutes.get('/redemptions/recent', async (c) => {
  const since = c.req.query('since')
  if (!since) return c.json({ error: 'since required' }, 400)
  return c.json({ redemptions: await packs.listRecentRedemptions(c.get('businessId'), since) })
})

packRoutes.get('/redemptions', async (c) => {
  const customerId = c.req.query('customer_id')
  if (!customerId) return c.json({ error: 'customer_id required' }, 400)
  return c.json({ redemptions: await packs.listRedemptionsByCustomer(c.get('businessId'), customerId) })
})

packRoutes.post('/redemptions', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.pack_id !== 'string' || typeof b.customer_id !== 'string' || typeof b.redeemed_on !== 'string') {
    return c.json({ error: 'pack_id, customer_id, redeemed_on required' }, 400)
  }
  return c.json(await packs.addRedemption(c.get('businessId'), b), 201)
})

packRoutes.delete('/redemptions/:id', async (c) => {
  // removed_by records WHO undid the burn (query param — DELETE bodies are
  // unreliable through proxies). Soft delete; reads exclude removed rows.
  const removedBy = c.req.query('removed_by') ?? null
  return c.json(
    await packs.removeRedemption(c.get('businessId'), c.req.param('id'), removedBy),
  )
})

// ─── customer_lifecycle ──────────────────────────────────────────────────────

packRoutes.get('/lifecycles', async (c) => {
  return c.json({ lifecycles: await packs.listLifecycles(c.get('businessId')) })
})

packRoutes.get('/lifecycle/:customerId', async (c) => {
  const row = await packs.getLifecycle(c.get('businessId'), c.req.param('customerId'))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

packRoutes.put('/lifecycle', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.customer_id !== 'string' || typeof b.status !== 'string') {
    return c.json({ error: 'customer_id and status required' }, 400)
  }
  return c.json(await packs.setLifecycle(c.get('businessId'), {
    customer_id: b.customer_id, status: b.status, referral: !!b.referral,
    updated_by: typeof b.updated_by === 'string' ? b.updated_by : null,
    reason: typeof b.reason === 'string' ? b.reason : null,
  }))
})

// ─── pack_alert_dismissals ───────────────────────────────────────────────────

packRoutes.get('/alert-dismissals', async (c) => {
  return c.json({ dismissals: await packs.listAlertDismissals(c.get('businessId')) })
})

packRoutes.post('/alert-dismissals', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.customer_id !== 'string' || typeof b.dismissed_by !== 'string') {
    return c.json({ error: 'customer_id and dismissed_by required' }, 400)
  }
  return c.json(await packs.addAlertDismissal(c.get('businessId'), b))
})

// ─── customer_contacts ───────────────────────────────────────────────────────

packRoutes.get('/contacts/recent', async (c) => {
  const since = c.req.query('since')
  if (!since) return c.json({ error: 'since required' }, 400)
  return c.json({ contacts: await packs.listRecentContacts(c.get('businessId'), since) })
})

packRoutes.post('/contacts', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.customer_id !== 'string' || typeof b.channel !== 'string' || typeof b.contacted_by !== 'string') {
    return c.json({ error: 'customer_id, channel, contacted_by required' }, 400)
  }
  return c.json(await packs.addContact(c.get('businessId'), b))
})

// ─── visit_reconcile_dismissals ──────────────────────────────────────────────

packRoutes.get('/visit-dismissals', async (c) => {
  const since = c.req.query('since')
  if (!since) return c.json({ error: 'since required' }, 400)
  return c.json({ dismissals: await packs.listVisitDismissals(c.get('businessId'), since) })
})

packRoutes.post('/visit-dismissals', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.customer_id !== 'string' || typeof b.visit_day !== 'string' || typeof b.dismissed_by !== 'string') {
    return c.json({ error: 'customer_id, visit_day, dismissed_by required' }, 400)
  }
  return c.json(await packs.addVisitDismissal(c.get('businessId'), b))
})
