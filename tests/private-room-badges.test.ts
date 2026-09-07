import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index.js'
import * as resourceService from '../src/services/resource.service.js'
import { SynqedClient } from '../packages/client/src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const foreignBusiness = randomUUID()
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'Content-Type': 'application/json' }
const req = (method: string, path: string, body?: unknown, businessId = TEST_BUSINESS_ID) => app.request(`/v1${path}`, {
  method, headers: { ...headers, 'x-business-id': businessId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
async function fixture() {
  const staff = await seedTestStaff({ role: 'OWNER' })
  const customer = await seedTestCustomer()
  const store = await testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: 'Rooms' } })
  const standard = await testPrisma.resource.create({ data: { businessId: TEST_BUSINESS_ID, storeId: store.id, name: 'Standard' } })
  const privateRoom = await testPrisma.resource.create({ data: { businessId: TEST_BUSINESS_ID, storeId: store.id, name: 'Private', roomClass: 'private_room' } })
  const input = { customer_id: customer.id, staff_id: staff.id, store_id: store.id, starts_at: '2026-09-21T01:00:00.000Z', ends_at: '2026-09-21T02:00:00.000Z' }
  return { staff, customer, store, standard, privateRoom, input }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await testPrisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.audit_scrub', 'on', true)`
    await tx.auditLog.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  })
  await testPrisma.appointment.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.resource.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.orgSettings.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
  await testPrisma.store.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('private-room booking flag and staff badges', () => {
  it('creates/reads/clears staff customer badges through the SDK and keeps the staff surface authenticated', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init))
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
    const customer = await client.customers.create({ name: 'Badge test', staff_badges: ['個室希望','要注意'] })
    expect(customer.staff_badges).toEqual(['個室希望','要注意'])
    expect((await client.customers.get(customer.id)).staff_badges).toEqual(customer.staff_badges)
    expect((await client.customers.update(customer.id, { staff_badges: [] })).staff_badges).toEqual([])
    expect((await app.request(`/v1/customers/${customer.id}`)).status).toBe(401)
    expect((await req('GET', `/customers/${customer.id}`, undefined, foreignBusiness)).status).toBe(404)
  })

  it('exposes per-business badge defaults and validates HQ configuration without exposing it in generic org settings', async () => {
    const { staff } = await fixture()
    const defaults = await (await req('GET', '/customer-badges')).json()
    expect(defaults.badges.map((b: {name: string}) => b.name)).toEqual(['個室希望','要注意'])
    const badges = [{ name: '独自', colour: '#123456', display_order: 10 }]
    expect(await (await req('PUT', '/customer-badges', { badges, acting_staff_id: staff.id })).json()).toEqual({ badges })
    expect(await (await req('GET', '/customer-badges', undefined, foreignBusiness)).json()).toEqual(defaults)
    expect(JSON.stringify(await (await req('GET', '/org-settings')).json())).not.toContain('独自')
    const junior = await seedTestStaff()
    expect((await req('PUT', '/customer-badges', { badges: [], acting_staff_id: junior.id })).status).toBe(403)
    expect((await req('PUT', '/customer-badges', { badges: [...badges,...badges], acting_staff_id: staff.id })).status).toBe(400)
  })

  it('stamps the private-menu requirement once and permits staff clearing without later re-derivation', async () => {
    const { input, privateRoom, standard } = await fixture()
    const menu = await testPrisma.menu.create({ data: { businessId: TEST_BUSINESS_ID, name: 'Private menu', durationMinutes: 60,
      priceListAmount: 8000, requiredRoomClass: 'private_room' } })
    const created = await req('POST', '/appointments', { ...input, menu_id: menu.id, requires_private_room: false })
    expect(created.status).toBe(201)
    const row = await created.json()
    expect(row.requires_private_room).toBe(true)
    expect((await req('PUT', `/appointments/${row.id}`, { resource_id: standard.id })).status).toBe(400)
    expect((await req('PUT', `/appointments/${row.id}`, { resource_id: privateRoom.id })).status).toBe(200)
    expect(await (await req('PUT', `/appointments/${row.id}`, { requires_private_room: false, resource_id: standard.id })).json()).toMatchObject({ requires_private_room: false })
    expect(await (await req('PUT', `/appointments/${row.id}`, { notes: 'Still cleared' })).json()).toMatchObject({ requires_private_room: false })
    expect((await req('PUT', `/appointments/${row.id}`, { requires_private_room: true })).status).toBe(400)
    expect(await (await req('PUT', `/appointments/${row.id}`, { requires_private_room: true, resource_id: privateRoom.id })).json()).toMatchObject({ requires_private_room: true })
  })

  it('stamps the customer badge on new bookings and does not retro-tag existing ones', async () => {
    const { input, customer } = await fixture()
    const old = await (await req('POST', '/appointments', input)).json()
    expect(old.requires_private_room).toBe(false)
    await req('PUT', `/customers/${customer.id}`, { staff_badges: ['個室希望'] })
    const created = await req('POST', '/appointments', { ...input, starts_at: '2026-09-22T01:00:00.000Z', ends_at: '2026-09-22T02:00:00.000Z' })
    expect(created.status).toBe(201)
    const newer = await created.json()
    expect(newer.requires_private_room).toBe(true)
    expect(await (await req('GET', `/appointments/${old.id}`)).json()).toMatchObject({ requires_private_room: false })
    await req('PUT', `/customers/${customer.id}`, { staff_badges: [] })
    expect(await (await req('PUT', `/appointments/${newer.id}`, { notes: 'Keep flag' })).json()).toMatchObject({ requires_private_room: true })
  })

  it('offers only private beds for flagged bookings and every free bed for unflagged bookings, private last', async () => {
    const { input, standard, privateRoom } = await fixture()
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init))
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
    const appointment = await client.appointments.create({ ...input, requires_private_room: true })
    expect((await client.resources.availableForAppointment(appointment.id)).resources.map(r => r.id)).toEqual([privateRoom.id])
    await client.appointments.update(appointment.id, { requires_private_room: false })
    expect((await client.resources.availableForAppointment(appointment.id)).resources.map(r => r.id)).toEqual([standard.id, privateRoom.id])
    await testPrisma.resource.update({ where: { id: standard.id }, data: { active: false } })
    expect((await client.resources.availableForAppointment(appointment.id)).resources.map(r => r.id)).toEqual([privateRoom.id])
    expect((await req('GET', `/resources/available-for-appointment/${appointment.id}`, undefined, foreignBusiness)).status).toBe(404)
  })

  it('subtracts blocks and cleanup, preserves own cleanup snapshot, and cancellation only adds room options', async () => {
    const { input, standard, privateRoom } = await fixture()
    const row = await (await req('POST', '/appointments', { ...input, resource_id: standard.id })).json()
    await testPrisma.resource.update({ where: { id: standard.id }, data: { cleanupMinutes: 60 } })
    // Own claim keeps its original zero-cleanup snapshot, so a block at its end is adjacent.
    const block = await (await req('POST', '/appointments', { kind: 'BLOCK', store_id: input.store_id, resource_id: standard.id,
      starts_at: input.ends_at, ends_at: '2026-09-21T03:00:00.000Z' })).json()
    const busyPrivate = await (await req('POST', '/appointments', { kind: 'BLOCK', store_id: input.store_id, resource_id: privateRoom.id,
      starts_at: input.starts_at, ends_at: input.ends_at })).json()
    const available = async () => (await (await req('GET', `/resources/available-for-appointment/${row.id}`)).json()).resources.map((r:{id:string}) => r.id)
    expect(await available()).toEqual([standard.id])
    await req('PUT', `/appointments/${busyPrivate.id}`, { status: 'CANCELLED' })
    expect(await available()).toEqual([standard.id, privateRoom.id])
    await req('PUT', `/appointments/${block.id}`, { status: 'CANCELLED' })
    expect(await available()).toEqual([standard.id, privateRoom.id])
  })

  it('rechecks the stored flag when restoring a cancelled standard-bed booking', async () => {
    const { input, standard, privateRoom } = await fixture()
    const row = await (await req('POST', '/appointments', { ...input, resource_id: standard.id })).json()
    expect((await req('PUT', `/appointments/${row.id}`, { status: 'CANCELLED' })).status).toBe(200)
    expect((await req('PUT', `/appointments/${row.id}`, { requires_private_room: true })).status).toBe(200)
    expect((await req('PUT', `/appointments/${row.id}`, { status: 'SCHEDULED' })).status).toBe(400)
    expect((await req('PUT', `/appointments/${row.id}`, { status: 'SCHEDULED', resource_id: privateRoom.id })).status).toBe(200)
  })

  it('refuses reclassifying a private bed while an active flagged booking holds it', async () => {
    const { input, privateRoom } = await fixture()
    const row = await (await req('POST', '/appointments', { ...input, resource_id: privateRoom.id, requires_private_room: true })).json()
    expect((await req('PATCH', `/resources/${privateRoom.id}`, { room_class: 'standard' })).status).toBe(400)
    expect((await req('PUT', `/appointments/${row.id}`, { status: 'CANCELLED' })).status).toBe(200)
    expect((await req('PATCH', `/resources/${privateRoom.id}`, { room_class: 'standard' })).status).toBe(200)
    expect((await req('PUT', `/appointments/${row.id}`, { status: 'SCHEDULED' })).status).toBe(400)
  })

  it('serializes concurrent private claims and bed reclassification', async () => {
    const { input, privateRoom } = await fixture()
    const results = await Promise.all([
      req('POST', '/appointments', { ...input, resource_id: privateRoom.id, requires_private_room: true }),
      req('PATCH', `/resources/${privateRoom.id}`, { room_class: 'standard' }),
    ])
    expect(results.map(r => r.status).sort()).toEqual(expect.arrayContaining([400]))
    expect(results.every(r => [200,201,400].includes(r.status))).toBe(true)
    const resource = await testPrisma.resource.findUniqueOrThrow({ where: { id: privateRoom.id } })
    const claims = await testPrisma.appointment.count({ where: { resourceId: privateRoom.id, requiresPrivateRoom: true,
      status: { notIn: ['CANCELLED','NO_SHOW'] } } })
    expect(resource.roomClass === 'private_room' || claims === 0).toBe(true)
  })

  it('allows a rebook FK reference while its source booking is locked for a room edit', async () => {
    const { input, privateRoom } = await fixture()
    const source = await (await req('POST', '/appointments', { ...input, resource_id: privateRoom.id, requires_private_room: true })).json()
    const otherStaff = await seedTestStaff()
    let entered!: () => void
    let release!: () => void
    const enteredGate = new Promise<void>(resolve => { entered = resolve })
    const releaseGate = new Promise<void>(resolve => { release = resolve })
    const check = resourceService.requirePrivateResource
    vi.spyOn(resourceService, 'requirePrivateResource').mockImplementationOnce(async (...args) => {
      entered() // update holds its source appointment lock at this point
      await releaseGate
      return check(...args)
    })
    const editing = req('PUT', `/appointments/${source.id}`, { requires_private_room: true })
    await enteredGate
    const rebooking = req('POST', '/appointments', { ...input, staff_id: otherStaff.id,
      starts_at: '2026-09-22T01:00:00.000Z', ends_at: '2026-09-22T02:00:00.000Z',
      resource_id: privateRoom.id, requires_private_room: true, rebooked_from_appointment_id: source.id })
    let timer: ReturnType<typeof setTimeout> | undefined
    let early: Response | null
    try {
      early = await Promise.race([rebooking, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500) })])
    } finally {
      if (timer) clearTimeout(timer)
      release()
    }
    const [editResult, rebookResult] = await Promise.all([editing, rebooking])
    expect(early?.status).toBe(201)
    expect(editResult.status).toBe(200)
    expect(rebookResult.status).toBe(201)
  })

  it('returns each concurrent badge update’s own committed values', async () => {
    const { staff } = await fixture()
    const definitions = ['First', 'Second', 'Third'].map(name => [{ name, colour: '#123456', display_order: 0 }])
    const responses = await Promise.all(definitions.map(badges => req('PUT', '/customer-badges', { badges, acting_staff_id: staff.id })))
    expect(await Promise.all(responses.map(response => response.json()))).toEqual(definitions.map(badges => ({ badges })))
  })
})
