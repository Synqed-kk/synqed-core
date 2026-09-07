import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index.js'
import { SynqedClient } from '../packages/client/src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const foreignBusiness = randomUUID()
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'Content-Type': 'application/json' }
const req = (method: string, path: string, body?: unknown, businessId = TEST_BUSINESS_ID) => app.request(`/v1${path}`, {
  method, headers: { ...headers, 'x-business-id': businessId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
async function fixture(size = 2) {
  const holder = await seedTestCustomer({ email: `${randomUUID()}@example.com` })
  const visitor = await seedTestCustomer({ email: `${randomUUID()}@example.com` })
  const staff = await seedTestStaff({ role: 'OWNER' })
  const pack = await (await req('POST', '/packs', { customer_id: holder.id, kind: 'family', pack_size: size, unit_price: 5000 })).json()
  const burn = { pack_id: pack.id, customer_id: visitor.id, redeemed_on: '2026-09-07', created_by: staff.id }
  const link = (customerIds = [holder.id, visitor.id]) => req('PUT', `/customer-links/${holder.id}`, { customer_ids: customerIds, acting_staff_id: staff.id })
  return { holder, visitor, staff, pack, burn, link }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await testPrisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.audit_scrub', 'on', true)`
    await tx.auditLog.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
  })
  await testPrisma.customer.deleteMany({ where: { businessId: foreignBusiness } })
  await testPrisma.idempotencyKey.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('family pack sharing', () => {
  it('links via SDK, exposes one owner-held pack to each member, and uses all burns for the balance', async () => {
    const { holder, visitor, staff, pack, burn } = await fixture()
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init))
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
    expect(await client.customers.setPackSharing(holder.id, [holder.id, visitor.id], staff.id)).toEqual({ customer_ids: [holder.id, visitor.id].sort() })
    expect(await client.customers.getPackSharing(visitor.id)).toEqual({ customer_ids: [holder.id, visitor.id].sort() })
    expect((await client.packs.listPacks(visitor.id)).map(p => p.id)).toEqual([pack.id])
    expect(await client.packs.listActivePacks()).toEqual([expect.objectContaining({ id: pack.id, customer_id: holder.id, eligible_customer_ids: [holder.id, visitor.id].sort() })])
    await client.packs.addRedemption(burn)
    await client.packs.addRedemption({ ...burn, customer_id: holder.id })
    expect(await client.packs.listPacks(visitor.id)).toEqual([expect.objectContaining({ id: pack.id, usage_count: 2, usage_last_redeemed_on: '2026-09-07' })])
    expect(await client.packs.listRedemptions(visitor.id, { include_shared: true })).toHaveLength(2)
    expect(await client.packs.listRedemptions(holder.id, { include_shared: true })).toHaveLength(2)
    const recent = await client.packs.listRecentRedemptions('2026-09-01')
    expect(recent.find(row => row.customer_id === visitor.id)).toMatchObject({ pack_holder_customer_id: holder.id })
    expect((await req('POST', '/packs/redemptions', burn)).status).toBe(409)
  })

  it('keeps actual visitor and holder in both audit events even after unlinking', async () => {
    const { holder, visitor, pack, burn, link } = await fixture()
    await link()
    const added = await (await req('POST', '/packs/redemptions', burn)).json()
    expect(await testPrisma.packRedemption.findUnique({ where: { id: added.id } })).toMatchObject({ customerId: visitor.id, packHolderCustomerId: holder.id })
    await link([holder.id])
    expect((await req('POST', '/packs/redemptions', burn)).status).toBe(400)
    expect((await (await req('GET', `/packs?customer_id=${visitor.id}`)).json()).packs).toEqual([])
    expect((await req('DELETE', `/packs/redemptions/${added.id}`)).status).toBe(200)
    const events = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID, action: { in: ['pack.shared_redeem','pack.shared_undo'] } }, orderBy: { at: 'asc' } })
    expect(events.map(event => event.action)).toEqual(['pack.shared_redeem','pack.shared_undo'])
    for (const event of events) expect(event.detail).toEqual({ pack_id: pack.id, pack_holder_customer_id: holder.id, visitor_customer_id: visitor.id })
    await req('DELETE', `/packs/redemptions/${added.id}`)
    expect(await testPrisma.auditLog.count({ where: { action: 'pack.shared_undo', businessId: TEST_BUSINESS_ID } })).toBe(1)
  })

  it('requires HQ configuration and refuses foreign/deleted/unlinked members or packs', async () => {
    const { holder, visitor, staff, burn, link } = await fixture()
    const foreign = await seedTestCustomer({ businessId: foreignBusiness })
    expect((await link([holder.id, foreign.id])).status).toBe(400)
    const junior = await seedTestStaff()
    expect((await req('PUT', `/customer-links/${holder.id}`, { customer_ids: [holder.id, visitor.id], acting_staff_id: junior.id })).status).toBe(403)
    expect((await req('POST', '/packs/redemptions', burn)).status).toBe(400)
    expect((await req('POST', '/packs/redemptions', burn, foreignBusiness)).status).toBe(400)
    await testPrisma.customer.update({ where: { id: visitor.id }, data: { deletedAt: new Date() } })
    expect((await link()).status).toBe(400)
    expect((await req('GET', `/customer-links/${holder.id}`, undefined, foreignBusiness)).status).toBe(404)
    expect((await req('PUT', `/customer-links/${holder.id}`, { customer_ids: [holder.id, holder.id], acting_staff_id: staff.id })).status).toBe(400)
  })

  it('does not accidentally merge families and supports three members with explicit removal', async () => {
    const { holder, visitor, link } = await fixture()
    const third = await seedTestCustomer({ email: 'third@example.com' })
    const other = await fixture()
    await other.link()
    expect((await link([holder.id, other.visitor.id])).status).toBe(400)
    expect((await link([holder.id, visitor.id, third.id])).status).toBe(200)
    expect((await (await req('GET', `/customer-links/${third.id}`)).json()).customer_ids).toHaveLength(3)
    await link([holder.id, third.id])
    expect((await (await req('GET', `/customer-links/${visitor.id}`)).json()).customer_ids).toEqual([visitor.id])
  })

  it('serializes two visitors spending the final unit and makes undo restore it', async () => {
    const { holder, burn, link } = await fixture(1)
    await link()
    const results = await Promise.all([req('POST', '/packs/redemptions', burn), req('POST', '/packs/redemptions', { ...burn, customer_id: holder.id })])
    expect(results.map(result => result.status).sort()).toEqual([201,409])
    const winner = await results.find(result => result.status === 201)!.json()
    await req('DELETE', `/packs/redemptions/${winner.id}`)
    expect((await req('POST', '/packs/redemptions', burn)).status).toBe(201)
  })

  it('checks booking attribution and excludes inactive shared packs', async () => {
    const { holder, visitor, staff, pack, burn, link } = await fixture()
    await link()
    const appointment = await testPrisma.appointment.create({ data: { businessId: TEST_BUSINESS_ID, customerId: holder.id, staffId: staff.id, startsAt: new Date('2026-09-08T01:00:00Z'), endsAt: new Date('2026-09-08T02:00:00Z') } })
    expect((await req('POST', '/packs/redemptions', { ...burn, appointment_id: appointment.id })).status).toBe(400)
    await testPrisma.appointment.update({ where: { id: appointment.id }, data: { customerId: visitor.id } })
    expect((await req('POST', '/packs/redemptions', { ...burn, customer_id: holder.id, appointment_id: appointment.id })).status).toBe(400)
    expect((await req('POST', '/packs/redemptions', { ...burn, appointment_id: 'bad' })).status).toBe(400)
    expect((await req('POST', '/packs/redemptions', { ...burn, appointment_id: appointment.id })).status).toBe(201)
    await req('PATCH', `/packs/${pack.id}/status`, { status: 'void' })
    expect((await (await req('GET', `/packs?customer_id=${visitor.id}`)).json()).packs).toEqual([])
    expect((await req('POST', '/packs/redemptions', burn)).status).toBe(409)
  })

  it('scrubs non-anchor family references and does not recreate erased identities during undo', async () => {
    const { holder, visitor, burn, link } = await fixture()
    await link()
    const added = await (await req('POST', '/packs/redemptions', burn)).json()
    expect((await req('DELETE', `/customers/${visitor.id}`)).status).toBe(200)
    const prior = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID } })
    expect(JSON.stringify(prior)).not.toContain(visitor.id)
    expect((await req('DELETE', `/packs/redemptions/${added.id}`)).status).toBe(200)
    const after = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID } })
    expect(JSON.stringify(after)).not.toContain(visitor.id)
    expect(await testPrisma.packRedemption.findUnique({ where: { id: added.id } })).toMatchObject({ customerId: visitor.id, packHolderCustomerId: holder.id })
  })

  it('keeps customer visit reads separate from shared balance reads and preserves historical holder corrections', async () => {
    const { holder, visitor, burn, link } = await fixture()
    await link()
    expect((await req('POST', '/packs/redemptions', burn)).status).toBe(201)
    expect((await (await req('GET', `/packs/redemptions?customer_id=${holder.id}`)).json()).redemptions).toHaveLength(0)
    expect((await (await req('GET', `/packs/redemptions?customer_id=${holder.id}&include_shared=true`)).json()).redemptions).toHaveLength(1)
    await testPrisma.customer.update({ where: { id: holder.id }, data: { deletedAt: new Date() } })
    expect((await req('POST', '/packs/redemptions', { ...burn, customer_id: holder.id, source: 'correction', reason: 'Historical fix' })).status).toBe(201)
    expect((await req('POST', '/packs/redemptions', burn)).status).toBe(400)
  })
})
