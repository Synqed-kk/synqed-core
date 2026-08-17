import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersSchema,
  upsertVisitsSchema,
} from '../validations/customer.js'
import * as customerService from '../services/customer.service.js'
import * as idempotencyService from '../services/idempotency.service.js'
import { customerEnrichment } from '../services/customer-enrichment.service.js'

export const customerRoutes = new Hono<AppEnv>()

// GET /v1/customers/enrichment — per-customer list badges (last visit, visit
// counts, next booking, 担当), aggregated in ONE query for the whole business.
// Replaces the app's whole-tenant karute+appointments+staff crawl. Before /:id.
customerRoutes.get('/enrichment', async (c) => {
  return c.json({ enrichment: await customerEnrichment(c.get('businessId')) })
})

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

// GET /v1/customers/counts-by-store  (MUST be before /:id)
customerRoutes.get('/counts-by-store', async (c) =>
  c.json(await customerService.countCustomersByStore(c.get('businessId'))),
)

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

// PUT /v1/customers/:id/visits  (bulk idempotent upsert of crawled visits)
customerRoutes.put('/:id/visits', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const parsed = upsertVisitsSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await customerService.upsertVisits(businessId, id, parsed.data.visits)
  return c.json(result)
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

// POST /v1/customers/:id/photos  (multipart: file, optional category/caption
// + session linkage: recording_session_id, captured_by_staff_id,
// taken_with_consent). Idempotency-Key header dedups retried uploads — the
// mobile retry added for the intermittent 502 must never store twice.
customerRoutes.post('/:id/photos', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const formData = await c.req.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)

  const category = formData.get('category')
  const caption = formData.get('caption')
  const recordingSessionId = formData.get('recording_session_id')
  const capturedByStaffId = formData.get('captured_by_staff_id')
  const takenWithConsent = formData.get('taken_with_consent')

  const idemKey = c.req.header('Idempotency-Key')
  let claimId: string | null = null
  if (idemKey) {
    const claim = await idempotencyService.claimKey(businessId, idemKey, 'photo')
    if (claim.kind === 'replay') {
      const existing = await customerService.getPhoto(businessId, id, claim.targetId)
      if (existing) return c.json(existing, 200)
      return c.json(
        { error: 'The photo created under this Idempotency-Key no longer exists.', code: 'IDEMPOTENT_REPLAY_GONE' },
        409,
      )
    }
    if (claim.kind === 'in_flight') {
      return c.json(
        { error: 'The original upload with this Idempotency-Key is still in progress. Retry.', code: 'IDEMPOTENT_IN_FLIGHT' },
        503,
        { 'Retry-After': '1' },
      )
    }
    claimId = claim.claimId
  }

  try {
    const photo = await customerService.uploadPhoto(businessId, id, file, {
      category: typeof category === 'string' ? category : undefined,
      caption: typeof caption === 'string' ? caption : null,
      recording_session_id: typeof recordingSessionId === 'string' && recordingSessionId ? recordingSessionId : null,
      captured_by_staff_id: typeof capturedByStaffId === 'string' && capturedByStaffId ? capturedByStaffId : null,
      taken_with_consent: takenWithConsent === 'true',
    })
    if (claimId) await idempotencyService.completeKey(claimId, photo.id)
    return c.json(photo)
  } catch (err) {
    if (claimId) await idempotencyService.releaseKey(claimId).catch(() => {})
    if (
      err instanceof Error &&
      (err.message === 'Customer not found' ||
        err.message === 'Recording session not found' ||
        err.message === 'Staff not found')
    ) {
      return c.json({ error: err.message }, 404)
    }
    if (
      err instanceof Error &&
      err.message === 'Recording session belongs to a different customer'
    ) {
      // Integrity conflict, not a missing resource.
      return c.json({ error: err.message }, 409)
    }
    throw err
  }
})

// DELETE /v1/customers/:id/photos/:photoId — SOFT delete (storage kept).
// ?deleted_by records WHO (query param — DELETE bodies unreliable via proxies).
customerRoutes.delete('/:id/photos/:photoId', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const photoId = c.req.param('photoId')
  try {
    await customerService.deletePhoto(businessId, id, photoId, c.req.query('deleted_by') ?? null)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Photo not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

// POST /v1/customers/:id/photos/:photoId/restore — undo a soft delete.
customerRoutes.post('/:id/photos/:photoId/restore', async (c) => {
  const businessId = c.get('businessId')
  try {
    return c.json(
      await customerService.restorePhoto(businessId, c.req.param('id'), c.req.param('photoId')),
    )
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
