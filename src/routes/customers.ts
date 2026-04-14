import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersSchema,
} from '../validations/customer.js'
import * as customerService from '../services/customer.service.js'

export const customerRoutes = new Hono<AppEnv>()

// GET /v1/customers/check-duplicate?name=...
// MUST be before /:id to avoid "check-duplicate" matching as an :id param
customerRoutes.get('/check-duplicate', async (c) => {
  const tenantId = c.get('tenantId')
  const name = c.req.query('name')

  if (!name) {
    return c.json({ error: 'name query parameter is required' }, 400)
  }

  const result = await customerService.checkDuplicateName(tenantId, name)
  return c.json(result)
})

// GET /v1/customers
customerRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listCustomersSchema.safeParse(rawQuery)

  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400)
  }

  const result = await customerService.listCustomers(tenantId, parsed.data)
  return c.json(result)
})

// GET /v1/customers/:id
customerRoutes.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')

  const customer = await customerService.getCustomer(tenantId, id)
  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404)
  }

  return c.json(customer)
})

// POST /v1/customers
customerRoutes.post('/', async (c) => {
  const tenantId = c.get('tenantId')
  const body = await c.req.json()
  const parsed = createCustomerSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400)
  }

  const customer = await customerService.createCustomer(tenantId, parsed.data)
  return c.json(customer, 201)
})

// PUT /v1/customers/:id
customerRoutes.put('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = updateCustomerSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400)
  }

  try {
    const customer = await customerService.updateCustomer(tenantId, id, parsed.data)
    return c.json(customer)
  } catch (err) {
    if (err instanceof Error && err.message === 'Customer not found') {
      return c.json({ error: 'Customer not found' }, 404)
    }
    throw err
  }
})

// DELETE /v1/customers/:id
customerRoutes.delete('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')

  await customerService.deleteCustomer(tenantId, id)
  return c.json({ success: true })
})
