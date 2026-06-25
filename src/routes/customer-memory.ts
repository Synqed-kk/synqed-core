import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import * as memoryService from '../services/customer-memory.service.js'

export const customerMemoryRoutes = new Hono<AppEnv>()

// Live memory items for a customer (?customer_id=).
customerMemoryRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const customerId = c.req.query('customer_id')
  if (!customerId) return c.json({ error: 'customer_id required' }, 400)
  return c.json({ items: await memoryService.listMemoryItems(businessId, customerId) })
})

customerMemoryRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.customer_id !== 'string' || typeof b.category !== 'string' || typeof b.label !== 'string') {
    return c.json({ error: 'customer_id, category, label required' }, 400)
  }
  const item = await memoryService.createMemoryItem(businessId, {
    customer_id: b.customer_id,
    category: b.category,
    label: b.label,
    detail: typeof b.detail === 'string' ? b.detail : null,
    source: typeof b.source === 'string' ? b.source : null,
    confidence: typeof b.confidence === 'number' ? b.confidence : null,
    pinned: typeof b.pinned === 'boolean' ? b.pinned : undefined,
    suggest_talking_point: typeof b.suggest_talking_point === 'boolean' ? b.suggest_talking_point : undefined,
  })
  return c.json(item, 201)
})

customerMemoryRoutes.patch('/:id', async (c) => {
  const businessId = c.get('businessId')
  const b = await c.req.json().catch(() => ({}))
  try {
    return c.json(await memoryService.updateMemoryItem(businessId, c.req.param('id'), b))
  } catch {
    return c.json({ error: 'Memory item not found' }, 404)
  }
})

customerMemoryRoutes.delete('/:id', async (c) => {
  const businessId = c.get('businessId')
  try {
    await memoryService.deleteMemoryItem(businessId, c.req.param('id'))
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Memory item not found' }, 404)
  }
})
