import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index.js'
import { isStorePolicyWriteErrorCode, SynqedClient, SynqedError } from '../packages/client/src/index.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const foreignBusiness = randomUUID()
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'Content-Type': 'application/json' }
const hours = { mon: { open: '10:00', close: '20:00' }, tue: null }
const policyWriteLock = 270027

async function dropRaceTrigger() {
  await testPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS core27_block_policy_write ON store_booking_policies')
  await testPrisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS core27_block_policy_write()')
}

async function waitForBlockedPolicyWrite() {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const [lock] = await testPrisma.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND objid = ${policyWriteLock} AND NOT granted
    `
    if (Number(lock.waiting) > 0) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('policy write never reached the transaction gate')
}

async function fixture() {
  const owner = await seedTestStaff({ role: 'OWNER', userId: randomUUID() })
  const store = await testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: 'Owner gate test' } })
  const day = await testPrisma.storeClosedDay.create({ data: { businessId: TEST_BUSINESS_ID, storeId: store.id, date: new Date('2026-10-01') } })
  return { owner, store, day }
}

type Write = 'policy' | 'add' | 'remove'
function write(kind: Write, storeId: string, dayId: string, actorId: string) {
  const path = `/v1/store-policies/${storeId}`
  return app.request(kind === 'policy' ? path : kind === 'add' ? `${path}/closed-days` : `${path}/closed-days/${dayId}?acting_staff_id=${actorId}`, {
    method: kind === 'policy' ? 'PUT' : kind === 'add' ? 'POST' : 'DELETE', headers,
    ...(kind === 'remove' ? {} : { body: JSON.stringify({ acting_staff_id: actorId, ...(kind === 'policy' ? { weekly_hours: hours } : { date: '2026-10-02' }) }) }),
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await dropRaceTrigger()
  await testPrisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.audit_scrub', 'on', true)`
    await tx.auditLog.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  })
  await testPrisma.storeClosedDay.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
  await testPrisma.storeBookingPolicy.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
  await testPrisma.businessGrant.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
  await testPrisma.staff.deleteMany({ where: { businessId: foreignBusiness } })
  await cleanupTestData()
})

describe.each<Write>(['policy', 'add', 'remove'])('CORE-27 %s owner boundary', kind => {
  it.each(['profile', 'foreign_staff', 'unknown'] as const)('refuses %s as an acting staff id without writing', async identity => {
    const { owner, store, day } = await fixture()
    const foreign = await seedTestStaff({ businessId: foreignBusiness, role: 'OWNER' })
    const actorId = identity === 'profile' ? owner.userId! : identity === 'foreign_staff' ? foreign.id : randomUUID()
    const response = await write(kind, store.id, day.id, actorId)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'acting_staff_not_in_business' } })
    expect(await testPrisma.storeBookingPolicy.count({ where: { storeId: store.id } })).toBe(0)
    expect(await testPrisma.storeClosedDay.count({ where: { storeId: store.id } })).toBe(1)
    expect(await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it.each(['STYLIST', 'ADMIN', 'ASSISTANT'] as const)('refuses %s even with an HQ_ADMIN grant', async role => {
    const { store, day } = await fixture()
    const staff = await seedTestStaff({ role })
    await testPrisma.businessGrant.create({ data: { businessId: TEST_BUSINESS_ID, staffId: staff.id, grant: 'HQ_ADMIN' } })
    const response = await write(kind, store.id, day.id, staff.id)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'acting_staff_role_forbidden' } })
    expect(await testPrisma.storeBookingPolicy.count({ where: { storeId: store.id } })).toBe(0)
    expect(await testPrisma.storeClosedDay.count({ where: { storeId: store.id } })).toBe(1)
  })

  it('refuses a real foreign store before considering its owner', async () => {
    const foreignOwner = await seedTestStaff({ businessId: foreignBusiness, role: 'OWNER' })
    const store = await testPrisma.store.create({ data: { businessId: foreignBusiness, name: 'Foreign store' } })
    const day = await testPrisma.storeClosedDay.create({ data: { businessId: foreignBusiness, storeId: store.id, date: new Date('2026-10-01') } })
    const response = await write(kind, store.id, day.id, foreignOwner.id)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'store_not_found', message: 'Store not found' } })
    expect(await testPrisma.storeBookingPolicy.count({ where: { storeId: store.id } })).toBe(0)
    expect(await testPrisma.storeClosedDay.count({ where: { storeId: store.id } })).toBe(1)
  })

  it('accepts the business OWNER core staff id', async () => {
    const { owner, store, day } = await fixture()
    const response = await write(kind, store.id, day.id, owner.id)
    expect(response.status).toBe(kind === 'add' ? 201 : 200)
    const body = await response.json()
    if (kind === 'policy') {
      expect(body).toMatchObject({ updated_by: owner.id, weekly_hours: hours })
      const audits = await testPrisma.auditLog.findMany({ where: { businessId: TEST_BUSINESS_ID, action: 'store_policy.edit' } })
      expect(audits).toHaveLength(1)
      expect(audits[0].actorId).toBe(owner.id)
    } else if (kind === 'add') expect(body.created_by).toBe(owner.id)
    else expect(await testPrisma.storeClosedDay.count({ where: { id: day.id } })).toBe(0)
  })
})

it('OWNER partial updates retain omitted fields and allow null hours with an honest source', async () => {
  const { owner, store, day } = await fixture()
  await write('policy', store.id, day.id, owner.id)
  const update = (body: object) => app.request(`/v1/store-policies/${store.id}`, { method: 'PUT', headers, body: JSON.stringify({ acting_staff_id: owner.id, ...body }) })
  expect((await (await update({ sell_slot_min: 45 })).json()).weekly_hours).toEqual(hours)
  const cleared = await update({ weekly_hours: null })
  expect(cleared.status).toBe(200)
  expect(await cleared.json()).toMatchObject({ weekly_hours: null, sell_slot_min: 45, source: 'custom', updated_by: owner.id })
})

it('holds the OWNER decision through the policy write transaction', async () => {
  const { owner, store, day } = await fixture()
  await testPrisma.$executeRawUnsafe(`
    CREATE FUNCTION core27_block_policy_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(${policyWriteLock});
      RETURN NEW;
    END $$
  `)
  await testPrisma.$executeRawUnsafe(`
    CREATE TRIGGER core27_block_policy_write
    BEFORE INSERT ON store_booking_policies
    FOR EACH ROW EXECUTE FUNCTION core27_block_policy_write()
  `)

  let releaseBlocker!: () => void
  let blockerReady!: () => void
  const release = new Promise<void>(resolve => { releaseBlocker = resolve })
  const ready = new Promise<void>(resolve => { blockerReady = resolve })
  const blocker = testPrisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${policyWriteLock})`)
    blockerReady()
    await release
  }, { timeout: 5000 })
  await ready

  const writePromise = write('policy', store.id, day.id, owner.id)
  let demotionSettled = false
  let demotion: Promise<unknown> | undefined
  try {
    await waitForBlockedPolicyWrite()
    demotion = testPrisma.staff.update({ where: { id: owner.id }, data: { role: 'STYLIST' } })
      .finally(() => { demotionSettled = true })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(demotionSettled).toBe(false)
  } finally {
    releaseBlocker()
    await blocker
  }

  expect((await writePromise).status).toBe(200)
  await demotion
  const refused = await write('policy', store.id, day.id, owner.id)
  expect(refused.status).toBe(403)
  expect(await refused.json()).toMatchObject({ error: { code: 'acting_staff_role_forbidden' } })
})

it('SDK exposes structured codes and keeps legacy string errors readable on every transport', async () => {
  const client = new SynqedClient({ baseUrl: 'https://core.invalid', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'acting_staff_role_forbidden', message: 'OWNER required' } }), { status: 403 })))
  for (const request of [() => client.fetch('/test'), () => client.fetchRaw('/test'), () => client.fetchMultipart('/test', new FormData())]) {
    await expect(request()).rejects.toMatchObject({ status: 403, message: 'OWNER required', code: 'acting_staff_role_forbidden' })
    await expect(request()).rejects.toBeInstanceOf(SynqedError)
  }
  expect(isStorePolicyWriteErrorCode('acting_staff_not_in_business')).toBe(true)
  expect(isStorePolicyWriteErrorCode('acting_staff_role_forbidden')).toBe(true)
  expect(isStorePolicyWriteErrorCode('store_not_found')).toBe(true)
  expect(isStorePolicyWriteErrorCode('unrelated_error')).toBe(false)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Legacy refusal' }), { status: 400 })))
  await expect(client.fetch('/test')).rejects.toMatchObject({ status: 400, message: 'Legacy refusal', code: undefined })
})
