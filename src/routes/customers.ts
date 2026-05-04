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
  const businessId = c.get('businessId')
  const name = c.req.query('name')

  if (!name) {
    return c.json({ error: 'name query parameter is required' }, 400)
  }

  const result = await customerService.checkDuplicateName(businessId, name)
  return c.json(result)
})

// GET /v1/customers
customerRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listCustomersSchema.safeParse(rawQuery)

  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400)
  }

  const result = await customerService.listCustomers(businessId, parsed.data)
  return c.json(result)
})

// GET /v1/customers/:id
customerRoutes.get('/:id', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')

  const customer = await customerService.getCustomer(businessId, id)
  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404)
  }

  return c.json(customer)
})

// POST /v1/customers
customerRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json()
  const parsed = createCustomerSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400)
  }

  const customer = await customerService.createCustomer(businessId, parsed.data)
  return c.json(customer, 201)
})

// PUT /v1/customers/:id
customerRoutes.put('/:id', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = updateCustomerSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400)
  }

  try {
    const customer = await customerService.updateCustomer(businessId, id, parsed.data)
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
  const businessId = c.get('businessId')
  const id = c.req.param('id')

  await customerService.deleteCustomer(businessId, id)
  return c.json({ success: true })
})

// GET /v1/customers/:id/photos
customerRoutes.get('/:id/photos', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  try {
    const result = await customerService.listPhotos(businessId, id)
    return c.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Customer not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// POST /v1/customers/:id/photos  (multipart: file, optional category, caption)
customerRoutes.post('/:id/photos', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const formData = await c.req.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)

  const category = formData.get('category')
  const caption = formData.get('caption')

  try {
    const photo = await customerService.uploadPhoto(businessId, id, file, {
      category: typeof category === 'string' ? category : undefined,
      caption: typeof caption === 'string' ? caption : null,
    })
    return c.json(photo)
  } catch (err) {
    if (err instanceof Error && err.message === 'Customer not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// DELETE /v1/customers/:id/photos/:photoId
customerRoutes.delete('/:id/photos/:photoId', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const photoId = c.req.param('photoId')
  try {
    await customerService.deletePhoto(businessId, id, photoId)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Photo not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// GET /v1/customers/:id/consent
customerRoutes.get('/:id/consent', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  try {
    const consent = await customerService.getConsent(businessId, id)
    return c.json({ consent })
  } catch (err) {
    if (err instanceof Error && err.message === 'Customer not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// POST /v1/customers/:id/consent
customerRoutes.post('/:id/consent', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))

  if (typeof body.granted_by_staff_id !== 'string') {
    return c.json({ error: 'granted_by_staff_id is required' }, 400)
  }
  if (typeof body.policy_version !== 'string') {
    return c.json({ error: 'policy_version is required' }, 400)
  }
  const method =
    body.method === 'VERBAL' || body.method === 'WRITTEN' ? body.method : 'VERBAL'

  try {
    const consent = await customerService.grantConsent(businessId, id, {
      grantedByStaffId: body.granted_by_staff_id,
      method,
      policyVersion: body.policy_version,
    })
    return c.json(consent)
  } catch (err) {
    if (err instanceof Error && err.message === 'Customer not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// DELETE /v1/customers/:id/consent
customerRoutes.delete('/:id/consent', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))

  if (typeof body.revoked_by_staff_id !== 'string') {
    return c.json({ error: 'revoked_by_staff_id is required' }, 400)
  }

  try {
    await customerService.revokeConsent(businessId, id, body.revoked_by_staff_id)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Customer not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})
