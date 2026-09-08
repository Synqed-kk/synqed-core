import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createMemberAccount, dailyOpen, pointLedger, recordPointsIn } from '../src/services/member-points.service.js'
import { prisma } from '../src/db/client.js'
import app from '../src/index.js'

vi.mock('../src/services/supabase-auth.service.js', () => ({ verifySupabaseAccessToken: vi.fn(async (token: string) => token === 'member-one' ? userId : token === 'member-two' ? otherUserId : null) }))
const businessId = randomUUID(), otherBusinessId = randomUUID()
let userId: string, otherUserId: string
let accountId: string, otherAccountId: string, storeId: string, otherStoreId: string
const scope = () => ({ businessId, accountId, storeId })
const db = new PrismaClient()
beforeEach(async () => {
  userId = randomUUID()
  otherUserId = randomUUID()
  process.env.API_KEYS = 'points-test-key'
  accountId = (await createMemberAccount(userId, 'Member one')).id
  otherAccountId = (await createMemberAccount(otherUserId, 'Member two')).id
  storeId = (await db.store.create({ data: { businessId, name: 'Issuing store' } })).id
  otherStoreId = (await db.store.create({ data: { businessId, name: 'Other store' } })).id
})
afterAll(async () => {
  // Append-only entries remain as evidence in the local test DB; random scopes
  // isolate them from other tests. Do not disable production integrity triggers.
  await db.$disconnect()
  await prisma.$disconnect()
})
function credit(amount: number, eventRef = randomUUID()) {
  return prisma.$transaction(tx => recordPointsIn(tx, { ...scope(), amount, eventRef, source: 'VISIT_CHECKIN' }))
}
function req(path: string, method = 'GET', body?: unknown, token = 'member-one') {
  return app.request(`/v1${path}`, { method, headers: { 'x-api-key': 'points-test-key', 'x-business-id': businessId,
    authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

describe('store points ledger', () => {
  it('registers one account per verified subject and never attaches historic customer records', async () => {
    const results = await Promise.all([createMemberAccount(userId, 'Other name'), createMemberAccount(userId, 'Other name')])
    expect(results.map(row => row.id)).toEqual([accountId, accountId])
    const denied = await req('/members/me', 'GET', undefined, 'invalid')
    expect(denied.status).toBe(401)
    const spoof = await req('/members/me', 'POST', { displayName: 'Name', accountId: otherAccountId })
    expect(spoof.status).toBe(400)
    expect((await req('/members/me/claim', 'POST', { customerId: randomUUID() })).status).toBe(501)
    const me = await req('/members/me')
    expect(await me.json()).toEqual({ accountId, displayName: 'Member one' })
  })

  it('credits an event once under concurrency and rejects altered replay', async () => {
    const eventRef = randomUUID()
    const results = await Promise.all([credit(100, eventRef), credit(100, eventRef)])
    expect(results.filter(row => row.replayed)).toHaveLength(1)
    expect((await pointLedger(scope())).balance).toBe(100)
    await expect(credit(101, eventRef)).rejects.toThrow('EVENT_CONFLICT')
  })

  it('serializes concurrent spends, refuses cross-store funding, and preserves rollback', async () => {
    await credit(100)
    const spend = (targetStore: string) => prisma.$transaction(tx => recordPointsIn(tx, { ...scope(), storeId: targetStore, amount: -80, eventRef: randomUUID(), source: 'DISCOUNT_REDEMPTION' }))
    await expect(spend(otherStoreId)).rejects.toThrow('INSUFFICIENT_POINTS')
    const results = await Promise.allSettled([spend(storeId), spend(storeId)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect((await pointLedger(scope())).balance).toBe(20)
    await expect(prisma.$transaction(async tx => {
      await recordPointsIn(tx, { ...scope(), amount: 50, eventRef: randomUUID(), source: 'CONTENT_READ' })
      throw new Error('Source event failed')
    })).rejects.toThrow('Source event failed')
    expect((await pointLedger(scope())).balance).toBe(20)
  })

  it('returns full balance on every page and fences account, store and business scope', async () => {
    await credit(10)
    await credit(10)
    const first = await pointLedger(scope(), undefined, 1)
    expect(first.balance).toBe(20)
    expect(first.entries).toHaveLength(1)
    expect(first.nextCursor).not.toBeNull()
    const second = await pointLedger(scope(), first.nextCursor!, 1)
    expect(second.balance).toBe(20)
    expect(second.entries[0].entryId).not.toBe(first.entries[0].entryId)
    await expect(pointLedger({ ...scope(), businessId: otherBusinessId })).rejects.toThrow('NOT_FOUND')
    await expect(pointLedger({ ...scope(), accountId: otherAccountId }, first.nextCursor!)).rejects.toThrow('NOT_FOUND')
    const response = await req(`/members/me/stores/${storeId}/points`, 'GET', undefined, 'member-two')
    expect((await response.json()).balance).toBe(0)
    const noMemberAward = await req(`/member-points/stores/${storeId}/adjustments`, 'POST', { accountId, amount: 1000, reason: 'Self award' })
    expect(noMemberAward.status).toBe(403)
  })

  it('paginates every entry when PostgreSQL timestamps share microseconds', async () => {
    const first = await credit(1)
    await db.$executeRaw`INSERT INTO point_entries(id,wallet_id,amount,source,event_ref,occurred_at) VALUES
      (gen_random_uuid(),${first.entry.walletId}::uuid,1,'VISIT_CHECKIN','micro-1','2030-01-01 00:00:00.123456+00'),
      (gen_random_uuid(),${first.entry.walletId}::uuid,1,'VISIT_CHECKIN','micro-2','2030-01-01 00:00:00.123456+00')`
    let cursor: string | undefined
    const ids: string[] = []
    do {
      const page = await pointLedger(scope(), cursor, 1)
      expect(page.balance).toBe(3)
      ids.push(...page.entries.map(row => row.entryId))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(new Set(ids).size).toBe(3)
  })

  it('grants configured daily points once per store and JST day, including after policy changes', async () => {
    await credit(20)
    expect(await dailyOpen(scope())).toMatchObject({ granted: 0, alreadyClaimedToday: false })
    await db.storePointPolicy.create({ data: { businessId, storeId, dailyOpenPoints: 7 } })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-08T14:59:59Z'))
      const results = await Promise.all([dailyOpen(scope()), dailyOpen(scope())])
      expect(results.map(row => row.granted).sort()).toEqual([0, 7])
      await db.storePointPolicy.update({ where: { storeId }, data: { dailyOpenPoints: 9 } })
      expect(await dailyOpen(scope())).toMatchObject({ granted: 0, alreadyClaimedToday: true, balance: 27 })
      vi.setSystemTime(new Date('2026-09-08T15:00:00Z')) // midnight in Tokyo
      expect(await dailyOpen(scope())).toMatchObject({ granted: 9, alreadyClaimedToday: false, balance: 36 })
    } finally { vi.useRealTimers() }
    expect(await dailyOpen({ ...scope(), storeId: otherStoreId })).toMatchObject({ granted: 0, balance: 0 })
  })

  it('uses current staff permissions and assigned stores for policy and adjustment writes', async () => {
    const staff = await db.staff.create({ data: { businessId, userId, name: 'Point operator', role: 'ADMIN' } })
    await db.staffPermission.create({ data: { businessId, staffId: staff.id, role: 'area_manager',
      hasOverrides: true, overrides: ['settings.manage', 'billing.manage'], assignedStoreIds: [storeId] } })
    expect((await req(`/member-points/stores/${otherStoreId}/policy`, 'PUT', { dailyOpenPoints: 7 })).status).toBe(404)
    expect((await req(`/member-points/stores/${storeId}/policy`, 'PUT', { dailyOpenPoints: 7 })).status).toBe(200)
    const idem = randomUUID()
    const adjust = () => app.request(`/v1/member-points/stores/${storeId}/adjustments`, { method: 'POST',
      headers: { 'x-api-key': 'points-test-key', 'x-business-id': businessId, authorization: 'Bearer member-one',
        'content-type': 'application/json', 'Idempotency-Key': idem },
      body: JSON.stringify({ accountId: otherAccountId, amount: 25, reason: 'Receipt correction' }) })
    expect((await adjust()).status).toBe(200)
    expect((await (await adjust()).json()).replayed).toBe(true)
    expect((await pointLedger({ ...scope(), accountId: otherAccountId })).balance).toBe(25)
    await db.staffPermission.update({ where: { staffId: staff.id }, data: { overrides: [] } })
    expect((await adjust()).status).toBe(403)
    expect((await req(`/member-points/stores/${storeId}/policy`, 'PUT', { dailyOpenPoints: 9 })).status).toBe(403)
  })

  it('enforces ledger immutability in PostgreSQL', async () => {
    await credit(27)
    const page = await pointLedger(scope())
    const id = page.entries[0].entryId
    await expect(db.pointEntry.update({ where: { id }, data: { amount: 900 } })).rejects.toThrow('append-only')
    await expect(db.pointEntry.delete({ where: { id } })).rejects.toThrow('append-only')
    expect((await pointLedger(scope())).balance).toBe(27)
  })
})
