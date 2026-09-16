import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index.js'
import * as policyService from '../src/services/store-policy.service.js'
import {
  isAppointmentWriteErrorCode,
  SynqedClient,
  SynqedError,
} from '../packages/client/src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  testPrisma,
  TEST_API_KEY,
  TEST_BUSINESS_ID,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}
const tuesday = {
  starts_at: '2026-09-22T02:00:00.000Z', // Tuesday 11:00 JST
  ends_at: '2026-09-22T03:00:00.000Z',
}
const foreignBusiness = randomUUID()
const closedDayWriteLock = 270022

async function dropRaceTrigger() {
  await testPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS core22_block_closed_day ON store_closed_days')
  await testPrisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS core22_block_closed_day()')
}

async function waitForBlockedClosedDayWrite() {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const [lock] = await testPrisma.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND objid = ${closedDayWriteLock} AND NOT granted
    `
    if (Number(lock.waiting) > 0) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('closed-day write never reached the transaction gate')
}

async function fixture() {
  const [customer, staff, store] = await Promise.all([
    seedTestCustomer(),
    seedTestStaff(),
    testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: 'Closed-day test' } }),
  ])
  return { customer, staff, store }
}

function createRequest(
  ids: Awaited<ReturnType<typeof fixture>>,
  overrides: Record<string, unknown> = {},
) {
  return app.request('/v1/appointments', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customer_id: ids.customer.id,
      staff_id: ids.staff.id,
      store_id: ids.store.id,
      ...tuesday,
      ...overrides,
    }),
  })
}

async function setPolicy(
  storeId: string,
  weeklyHours: Prisma.InputJsonValue | typeof Prisma.DbNull,
  specialOpenDays: Prisma.InputJsonValue = [],
) {
  return testPrisma.storeBookingPolicy.create({
    data: {
      businessId: TEST_BUSINESS_ID,
      storeId,
      weeklyHours,
      specialOpenDays,
    },
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await dropRaceTrigger()
  await cleanupTestData()
  await testPrisma.storeClosedDay.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.storeBookingPolicy.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
})

describe('CORE-22 store-closed appointment writes', () => {
  it.each(['MANUAL', 'SYNQED_RESERVE'] as const)('refuses a weekly closed day for %s', async source => {
    const ids = await fixture()
    await setPolicy(ids.store.id, { mon: { open: '10:00', close: '20:00' }, tue: null })

    const response = await createRequest(ids, { source })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'The store is closed on the requested date.',
      code: 'STORE_CLOSED',
    })
    expect(await testPrisma.appointment.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it('lets a special opening override both weekly and ad-hoc closure', async () => {
    const ids = await fixture()
    await setPolicy(
      ids.store.id,
      { tue: null },
      [{ date: '2026-09-22', open: '10:00', close: '20:00' }],
    )
    await testPrisma.storeClosedDay.create({
      data: { businessId: TEST_BUSINESS_ID, storeId: ids.store.id, date: new Date('2026-09-22T00:00:00.000Z') },
    })

    expect((await createRequest(ids)).status).toBe(201)
  })

  it('refuses an ad-hoc closed date even when the weekday is open', async () => {
    const ids = await fixture()
    await setPolicy(ids.store.id, { tue: { open: '10:00', close: '20:00' } })
    await testPrisma.storeClosedDay.create({
      data: { businessId: TEST_BUSINESS_ID, storeId: ids.store.id, date: new Date('2026-09-22T00:00:00.000Z') },
    })

    const response = await createRequest(ids)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('STORE_CLOSED')
  })

  it('keeps unconfigured weekly hours permissive', async () => {
    const ids = await fixture()
    await setPolicy(ids.store.id, Prisma.DbNull)

    expect((await createRequest(ids)).status).toBe(201)
  })

  it('refuses a reschedule onto a closed date and leaves the original time intact', async () => {
    const ids = await fixture()
    await setPolicy(ids.store.id, { mon: { open: '10:00', close: '20:00' }, tue: null })
    const created = await (await createRequest(ids, {
      starts_at: '2026-09-21T02:00:00.000Z',
      ends_at: '2026-09-21T03:00:00.000Z',
    })).json()

    const response = await app.request(`/v1/appointments/${created.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(tuesday),
    })

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('STORE_CLOSED')
    expect((await testPrisma.appointment.findUniqueOrThrow({ where: { id: created.id } })).startsAt.toISOString())
      .toBe('2026-09-21T02:00:00.000Z')
  })

  it('uses the JST weekday when the UTC calendar date differs', async () => {
    const ids = await fixture()
    await setPolicy(ids.store.id, { mon: { open: '00:00', close: '20:00' }, sun: null })

    const response = await createRequest(ids, {
      starts_at: '2026-09-20T15:30:00.000Z', // Monday 00:30 JST, Sunday in UTC
      ends_at: '2026-09-20T16:00:00.000Z',
    })
    expect(response.status).toBe(201)
  })

  it('refuses a real foreign store without revealing its tenancy', async () => {
    const ids = await fixture()
    const foreignStore = await testPrisma.store.create({
      data: { businessId: foreignBusiness, name: 'Foreign store' },
    })

    const response = await createRequest(ids, { store_id: foreignStore.id })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Store not found.' })
    expect(await testPrisma.appointment.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it('serializes a booking behind a concurrent closed-day write', async () => {
    const ids = await fixture()
    await setPolicy(ids.store.id, { tue: { open: '10:00', close: '20:00' } })
    await testPrisma.$executeRawUnsafe(`
      CREATE FUNCTION core22_block_closed_day() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${closedDayWriteLock});
        RETURN NEW;
      END $$
    `)
    await testPrisma.$executeRawUnsafe(`
      CREATE TRIGGER core22_block_closed_day
      BEFORE INSERT ON store_closed_days
      FOR EACH ROW EXECUTE FUNCTION core22_block_closed_day()
    `)

    let releaseBlocker!: () => void
    let blockerReady!: () => void
    const release = new Promise<void>(resolve => { releaseBlocker = resolve })
    const ready = new Promise<void>(resolve => { blockerReady = resolve })
    const blocker = testPrisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${closedDayWriteLock})`)
      blockerReady()
      await release
    }, { timeout: 5000 })
    await ready

    const closure = policyService.addClosedDay(TEST_BUSINESS_ID, ids.store.id, { date: '2026-09-22' })
    await waitForBlockedClosedDayWrite()
    let bookingSettled = false
    const booking = createRequest(ids).finally(() => { bookingSettled = true })
    try {
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(bookingSettled).toBe(false)
    } finally {
      releaseBlocker()
      await blocker
    }

    expect(await closure).not.toBeNull()
    const response = await booking
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('STORE_CLOSED')
  })

  it('does not constrain direct QuickReserve crawl persistence', async () => {
    const ids = await fixture()
    await setPolicy(ids.store.id, { tue: null })

    const row = await testPrisma.appointment.create({
      data: {
        businessId: TEST_BUSINESS_ID,
        customerId: ids.customer.id,
        staffId: ids.staff.id,
        storeId: ids.store.id,
        startsAt: new Date(tuesday.starts_at),
        endsAt: new Date(tuesday.ends_at),
        source: 'QUICKRESERVE',
      },
    })
    expect(row.source).toBe('QUICKRESERVE')
  })

  it('surfaces STORE_CLOSED through the SDK error contract', async () => {
    const client = new SynqedClient({
      baseUrl: 'https://core.invalid',
      apiKey: TEST_API_KEY,
      businessId: TEST_BUSINESS_ID,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'The store is closed on the requested date.',
      code: 'STORE_CLOSED',
    }), { status: 409 })))

    await expect(client.appointments.create({} as never)).rejects.toMatchObject({
      status: 409,
      code: 'STORE_CLOSED',
    })
    await expect(client.appointments.create({} as never)).rejects.toBeInstanceOf(SynqedError)
    expect(isAppointmentWriteErrorCode('STORE_CLOSED')).toBe(true)
    expect(isAppointmentWriteErrorCode('RESOURCE_TAKEN')).toBe(true)
    expect(isAppointmentWriteErrorCode('unrelated')).toBe(false)
  })
})
