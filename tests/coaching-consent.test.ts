import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../src/db/client.js'
import app from '../src/index.js'
import { upsertOrgSettings } from '../src/services/org-settings.service.js'

vi.mock('../src/services/supabase-auth.service.js', () => ({
  verifySupabaseAccessToken: vi.fn(async (token: string) => subjects.get(token) ?? null),
}))
const subjects = new Map<string, string>()
let businessId: string, storeId: string, otherStoreId: string, staffId: string, peerId: string, ownerId: string
const policy = 'v1.0-2026-05'
function req(path = '/me', method = 'GET', body?: unknown, token = 'staff', business = businessId) {
  return app.request(`/v1/coaching-consent${path}`, { method, headers: {
    'x-api-key': 'consent-test', 'x-business-id': business, authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const decide = (status: 'granted' | 'declined', token = 'staff', version = policy) =>
  req('/me', 'POST', { status, policy_version: version }, token)

beforeEach(async () => {
  process.env.API_KEYS = 'consent-test'
  businessId = randomUUID()
  subjects.clear()
  for (const token of ['staff', 'peer', 'owner', 'foreign']) subjects.set(token, randomUUID())
  const create = (token: string, role: 'OWNER' | 'STYLIST' = 'STYLIST', business = businessId) =>
    prisma.staff.create({ data: { businessId: business, userId: subjects.get(token), name: token, role } })
  staffId = (await create('staff')).id
  peerId = (await create('peer')).id
  ownerId = (await create('owner', 'OWNER')).id
  await create('foreign', 'OWNER', randomUUID())
  storeId = (await prisma.store.create({ data: { businessId, name: 'First store' } })).id
  otherStoreId = (await prisma.store.create({ data: { businessId, name: 'Second store' } })).id
  await prisma.staffStore.create({ data: { businessId, staffId, storeId } })
  await prisma.staffStore.create({ data: { businessId, staffId: peerId, storeId: otherStoreId } })
})
afterAll(() => prisma.$disconnect())

describe('coaching consent privacy', () => {
  it('requires a verified active login and never treats a matching card ID as a login', async () => {
    expect((await req('/me', 'GET', undefined, 'invalid')).status).toBe(401)
    expect((await req('/me', 'GET', undefined, 'foreign')).status).toBe(403)
    const noBearer = await app.request('/v1/coaching-consent/me', { headers: { 'x-api-key': 'consent-test', 'x-business-id': businessId } })
    expect(noBearer.status).toBe(401)
    await prisma.staff.create({ data: { id: subjects.get('foreign'), businessId, name: 'Shadow owner', role: 'OWNER' } })
    expect((await req('/me', 'GET', undefined, 'foreign')).status).toBe(403)
    await prisma.staff.update({ where: { id: staffId }, data: { isActive: false } })
    expect((await decide('granted')).status).toBe(403)
  })

  it('keeps decisions and history self-only with no owner exception or forged subject', async () => {
    expect((await req('/me', 'POST', { status: 'granted', policy_version: policy, staff_id: peerId })).status).toBe(400)
    const response = await decide('granted')
    expect(response.status).toBe(201)
    const decision = await response.json()
    expect(await (await req()).json()).toMatchObject({ status: 'granted', decision: { id: decision.id } })
    expect(await (await req('/me', 'GET', undefined, 'owner')).json()).toMatchObject({ status: 'unset', decision: null })
    expect((await req(`/${staffId}`, 'GET', undefined, 'owner')).status).toBe(404)
    expect(await (await req('/me/history', 'GET', undefined, 'owner')).json()).toEqual({ decisions: [], next_cursor: null })
    expect((await req(`/me/history?cursor=${decision.id}`, 'GET', undefined, 'owner')).status).toBe(404)
    expect((await req('/me/history?cursor=')).status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    // No general audit event that would expose decline or withdrawal to a manager.
    expect(await prisma.auditLog.count({ where: { businessId } })).toBe(0)
  })

  it('appends changes, orders tied timestamps by sequence, and paginates only own history', async () => {
    const time = new Date('2026-01-01T00:00:00Z')
    await prisma.coachingConsent.createMany({ data: Array.from({ length: 52 }, (_, i) => ({
      businessId, staffId, authUserId: subjects.get('staff')!, createdBy: staffId, status: i === 51 ? 'declined' : 'granted', policyVersion: policy, createdAt: time,
    })) })
    expect(await (await req()).json()).toMatchObject({ status: 'declined' })
    const first = await (await req('/me/history')).json()
    expect(first.decisions).toHaveLength(50)
    const second = await (await req(`/me/history?cursor=${first.next_cursor}`)).json()
    expect(second.decisions).toHaveLength(2)
    expect(second.next_cursor).toBeNull()
    expect(new Set([...first.decisions, ...second.decisions].map(row => row.id)).size).toBe(52)
    expect((await decide('granted')).status).toBe(201)
    expect(await prisma.coachingConsent.count({ where: { businessId, staffId } })).toBe(53)
  })

  it('invalidates old grants after policy changes while allowing a stale dialog to withdraw', async () => {
    await decide('granted')
    await prisma.orgSettings.create({ data: { businessId, settings: { coaching_policy_version: 2 } } })
    expect(await (await req()).json()).toMatchObject({ status: 'unset', current_policy_version: '2' })
    expect((await decide('granted')).status).toBe(409)
    expect((await decide('declined')).status).toBe(201)
    expect(await (await req()).json()).toMatchObject({ status: 'declined', decision: { policy_version: '2' } })
    expect((await decide('granted', 'staff', '2')).status).toBe(201)
    expect(await (await req()).json()).toMatchObject({ status: 'granted' })
  })

  it('returns only store counts and applies current viewing capability and store assignments', async () => {
    await decide('granted')
    await decide('declined', 'peer')
    const path = `/stores/${storeId}/adoption`
    expect(await (await req(path, 'GET', undefined, 'owner')).json()).toEqual({ granted: 1, total: 2 })
    expect(await (await req(`/stores/${otherStoreId}/adoption`, 'GET', undefined, 'owner')).json()).toEqual({ granted: 0, total: 2 })
    expect((await req(path)).status).toBe(403)
    await prisma.staffPermission.create({ data: { businessId, staffId: ownerId, role: 'area_manager',
      hasOverrides: true, overrides: ['analytics.viewAll'], assignedStoreIds: [storeId] } })
    expect((await req(path, 'GET', undefined, 'owner')).status).toBe(200)
    expect((await req(`/stores/${otherStoreId}/adoption`, 'GET', undefined, 'owner')).status).toBe(404)
    expect((await req(`/stores/${randomUUID()}/adoption`, 'GET', undefined, 'owner')).status).toBe(404)
    await prisma.staffPermission.update({ where: { staffId: ownerId }, data: { overrides: [] } })
    expect((await req(path, 'GET', undefined, 'owner')).status).toBe(403)
  })

  it('enforces append-only and tenant/self authorship in the DB without blocking staff offboarding', async () => {
    const row = await (await decide('declined')).json()
    await expect(prisma.coachingConsent.update({ where: { id: row.id }, data: { status: 'granted' } })).rejects.toThrow('append-only')
    await expect(prisma.coachingConsent.delete({ where: { id: row.id } })).rejects.toThrow('append-only')
    await expect(prisma.coachingConsent.create({ data: { businessId: randomUUID(), staffId, authUserId: subjects.get('staff')!, createdBy: staffId,
      status: 'granted', policyVersion: policy } })).rejects.toThrow('Active staff not found')
    await expect(prisma.coachingConsent.create({ data: { businessId, staffId, authUserId: subjects.get('staff')!, createdBy: ownerId,
      status: 'granted', policyVersion: policy } })).rejects.toThrow('coaching_consent_self_authored')
    await prisma.staff.delete({ where: { id: staffId } })
    expect(await prisma.coachingConsent.count({ where: { id: row.id } })).toBe(1)
    expect((await req()).status).toBe(403)
  })


  it('does not transfer consent or private history when a staff card changes login', async () => {
    const decision = await (await decide('granted')).json()
    const replacement = randomUUID()
    subjects.set('replacement', replacement)
    await prisma.staff.update({ where: { id: staffId }, data: { userId: replacement } })
    expect(await (await req('/me', 'GET', undefined, 'replacement')).json()).toMatchObject({ status: 'unset', decision: null })
    expect(await (await req('/me/history', 'GET', undefined, 'replacement')).json()).toEqual({ decisions: [], next_cursor: null })
    expect((await req(`/me/history?cursor=${decision.id}`, 'GET', undefined, 'replacement')).status).toBe(404)
    expect(await (await req(`/stores/${storeId}/adoption`, 'GET', undefined, 'owner')).json()).toEqual({ granted: 0, total: 2 })
    expect((await req()).status).toBe(403)
    expect((await decide('granted', 'replacement')).status).toBe(201)
  })

  it('keeps withdrawal possible when an older settings writer saved an oversized policy version', async () => {
    await decide('granted')
    await prisma.orgSettings.create({ data: { businessId, settings: { coaching_policy_version: 'x'.repeat(201) } } })
    expect(await (await req()).json()).toMatchObject({ current_policy_version: policy })
    expect((await decide('declined')).status).toBe(201)
    expect(await (await req()).json()).toMatchObject({ status: 'declined' })
  })


  it.each([false, true])('serializes consent with policy publication (existing settings: %s)', async (existing) => {
    if (existing) await prisma.orgSettings.create({ data: { businessId, settings: { coaching_policy_version: policy } } })
    let release!: () => void, published!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { published = resolve })
    const publisher = prisma.$transaction(async tx => {
      await tx.orgSettings.upsert({ where: { businessId },
        create: { businessId, settings: { coaching_policy_version: 'new-policy' } },
        update: { settings: { coaching_policy_version: 'new-policy' } } })
      published()
      await hold
    })
    await ready
    const pendingDecision = decide('granted')
    try {
      await waitForLock('org_settings', 'ShareLock', false)
    } finally { release() }
    await publisher
    expect((await pendingDecision).status).toBe(409)
    expect(await prisma.coachingConsent.count({ where: { businessId } })).toBe(0)
  })

  it('holds publication until an already-started grant transaction commits', async () => {
    let release!: () => void, locked!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { locked = resolve })
    const staffLock = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM staff WHERE id=${staffId}::uuid FOR UPDATE`
      locked()
      await hold
    })
    await ready
    const pendingDecision = decide('granted')
    let publisher: Promise<unknown> | undefined
    try {
      await waitForLock('org_settings', 'ShareLock', true)
      publisher = upsertOrgSettings(businessId, { settings: { coaching_policy_version: 'next-policy' } })
      await waitForLock('org_settings', 'RowExclusiveLock', false)
    } finally { release() }
    await staffLock
    expect((await pendingDecision).status).toBe(201)
    await publisher
    expect(await (await req()).json()).toMatchObject({ status: 'unset', current_policy_version: 'next-policy' })
  })

  it('denies every direct browser policy, including any owner or manager L1 exception', async () => {
    const [table] = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT relrowsecurity FROM pg_class WHERE oid = 'coaching_consent'::regclass`
    expect(table.relrowsecurity).toBe(true)
    // API is the chosen enforcement door. No direct RLS policy is allowed at all:
    // CI will fail if a future policy introduces even a role-free browser bypass.
    expect(await prisma.$queryRaw`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coaching_consent'`).toEqual([])
  })
})

async function waitForLock(table: string, mode: string, granted: boolean) {
  for (let i = 0; i < 150; i++) {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM pg_locks WHERE relation = ${table}::regclass AND mode = ${mode} AND granted = ${granted}`
    if (rows[0].count > 0n) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Expected ${table} ${mode} granted=${granted}`)
}
