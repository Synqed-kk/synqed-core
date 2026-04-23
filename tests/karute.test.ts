import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  seedTestKaruteRecord,
  TEST_TENANT_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const headers = {
  'x-api-key': TEST_API_KEY,
  'x-tenant-id': TEST_TENANT_ID,
  'Content-Type': 'application/json',
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

describe('Karute Records — date range filter', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('returns records within from/to window', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()

    const inWindow = await seedTestKaruteRecord({
      customerId: customer.id,
      staffId: staff.id,
      createdAt: new Date('2026-04-15T12:00:00Z'),
    })
    await seedTestKaruteRecord({
      customerId: customer.id,
      staffId: staff.id,
      createdAt: new Date('2026-04-01T12:00:00Z'),
    })

    const res = await req(
      'GET',
      '/karute-records?from=2026-04-10T00:00:00Z&to=2026-04-20T00:00:00Z',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.karute_records).toHaveLength(1)
    expect(body.karute_records[0].id).toBe(inWindow.id)
  })

  it('from only (no to)', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    await seedTestKaruteRecord({
      customerId: customer.id,
      staffId: staff.id,
      createdAt: new Date('2026-04-15T12:00:00Z'),
    })
    await seedTestKaruteRecord({
      customerId: customer.id,
      staffId: staff.id,
      createdAt: new Date('2026-04-01T12:00:00Z'),
    })

    const res = await req('GET', '/karute-records?from=2026-04-10T00:00:00Z')
    const body = await res.json()
    expect(body.karute_records).toHaveLength(1)
  })
})
