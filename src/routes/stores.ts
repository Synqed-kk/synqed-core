import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import { createStoreSchema, updateStoreSchema } from '../validations/store.js'
import * as storeService from '../services/store.service.js'

export const storeRoutes = new Hono<AppEnv>()

storeRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const stores = await storeService.listStores(businessId)
  return c.json({ stores })
})

storeRoutes.get('/:id', async (c) => {
  const businessId = c.get('businessId')
  const store = await storeService.getStore(businessId, c.req.param('id'))
  if (!store) return c.json({ error: 'Store not found' }, 404)
  return c.json(store)
})

storeRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createStoreSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const store = await storeService.createStore(businessId, parsed.data)
  return c.json(store, 201)
})

storeRoutes.patch('/:id', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateStoreSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const store = await storeService.updateStore(businessId, c.req.param('id'), parsed.data)
    return c.json(store)
  } catch {
    return c.json({ error: 'Store not found' }, 404)
  }
})
