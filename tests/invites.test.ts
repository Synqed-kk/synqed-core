import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import app from '../src/index.js'
import { testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'
import { SynqedClient } from '../packages/client/src/index.js'

process.env.API_KEYS = TEST_API_KEY

const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

async function cleanupInvites() {
  await testPrisma.invite.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
}

// invited_staff_id is the link that lets acceptInvite ATTACH an existing staff
// row (set its user_id) instead of minting a duplicate. It must round-trip
// through create AND the pre-auth by-token lookup (accept reads it from there).
describe('invites carry invited_staff_id', () => {
  beforeEach(cleanupInvites)
  afterEach(cleanupInvites)

  it('stores and returns invited_staff_id on create', async () => {
    const staffId = '11111111-1111-1111-1111-111111111111'
    const res = await req('POST', '/invites', {
      email: 'existing@example.com',
      role: 'STYLIST',
      token: 'a'.repeat(64),
      invited_staff_id: staffId,
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.invited_staff_id).toBe(staffId)
  })

  it('exposes invited_staff_id via the public by-token lookup', async () => {
    const staffId = '22222222-2222-2222-2222-222222222222'
    const token = 'b'.repeat(64)
    await req('POST', '/invites', {
      email: 'x@example.com',
      role: 'STYLIST',
      token,
      invited_staff_id: staffId,
    })
    const res = await app.request(`/v1/invites/by-token/${token}`, { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invited_staff_id).toBe(staffId)
  })

  it('defaults invited_staff_id to null for an email-only invite', async () => {
    const res = await req('POST', '/invites', {
      email: 'new@example.com',
      role: 'STYLIST',
      token: 'c'.repeat(64),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.invited_staff_id).toBeNull()
  })
})

// CORE-33: one invite by id, tenant-scoped like the list.
describe('GET /invites/:id', () => {
  const OTHER_BUSINESS = '00000000-0000-0000-0000-0000000000c3'
  beforeEach(cleanupInvites)
  afterEach(async () => {
    await cleanupInvites()
    await testPrisma.invite.deleteMany({ where: { businessId: OTHER_BUSINESS } })
  })

  it('returns the row for this tenant', async () => {
    const created = await (
      await req('POST', '/invites', { email: 'one@example.com', role: 'STYLIST', token: 'd'.repeat(64) })
    ).json()
    const res = await req('GET', `/invites/${created.id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(created)
  })

  it("404s on another tenant's invite", async () => {
    const other = await testPrisma.invite.create({
      data: { businessId: OTHER_BUSINESS, email: 'o@example.com', role: 'STYLIST', token: 'e'.repeat(64) },
    })
    const res = await req('GET', `/invites/${other.id}`)
    expect(res.status).toBe(404)
  })

  it('404s on a non-uuid id and on a bare by-token path', async () => {
    for (const path of ['/invites/not-a-uuid', '/invites/by-token']) {
      const res = await req('GET', path)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Invite not found' })
    }
  })

  it('404s when absent', async () => {
    const res = await req('GET', '/invites/33333333-3333-3333-3333-333333333333')
    expect(res.status).toBe(404)
  })
})

// CORE-33: paging is opt-in. No params = every row, same shape as before.
describe('GET /invites paging', () => {
  beforeEach(async () => {
    await cleanupInvites()
    for (let i = 0; i < 3; i++) {
      await testPrisma.invite.create({
        data: {
          businessId: TEST_BUSINESS_ID,
          email: `p${i}@example.com`,
          role: 'STYLIST',
          token: `page-${i}`.padEnd(64, 'x'),
          createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
        },
      })
    }
  })
  afterEach(cleanupInvites)

  it('returns every row and no paging fields without params', async () => {
    const body = await (await req('GET', '/invites')).json()
    expect(Object.keys(body)).toEqual(['invites'])
    expect(body.invites.map((i: { email: string }) => i.email)).toEqual([
      'p2@example.com',
      'p1@example.com',
      'p0@example.com',
    ])
  })

  it('pages newest first and reports total', async () => {
    const body = await (await req('GET', '/invites?page=2&page_size=2')).json()
    expect(body.invites.map((i: { email: string }) => i.email)).toEqual(['p0@example.com'])
    expect(body).toMatchObject({ total: 3, page: 2, page_size: 2 })
  })

  it('defaults page_size to 100 when only page is given', async () => {
    const body = await (await req('GET', '/invites?page=1')).json()
    expect(body).toMatchObject({ total: 3, page: 1, page_size: 100 })
    expect(body.invites).toHaveLength(3)
  })

  it('pages rows with the same created_at without overlap or loss', async () => {
    await cleanupInvites()
    const createdAt = new Date(Date.UTC(2026, 1, 1))
    await testPrisma.invite.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        businessId: TEST_BUSINESS_ID,
        email: `tie${i}@example.com`,
        role: 'STYLIST',
        token: `tie-${i}`.padEnd(64, 'x'),
        createdAt,
      })),
    })
    const seen: string[] = []
    for (let page = 1; page <= 10; page++) {
      const body = await (await req('GET', `/invites?page=${page}&page_size=3`)).json()
      seen.push(...body.invites.map((i: { id: string }) => i.id))
    }
    expect(seen).toHaveLength(30)
    expect(new Set(seen).size).toBe(30)
  })

  it('rejects a page above the 100000 cap', async () => {
    for (const page of ['1e308', '100001']) {
      expect((await req('GET', `/invites?page=${page}`)).status).toBe(400)
    }
  })

  it('rejects page_size above the 200 cap', async () => {
    const res = await req('GET', '/invites?page_size=201')
    expect(res.status).toBe(400)
  })
})

// CORE-33: the SDK contract, run against the real app.
describe('SDK invites.get / invites.list paging', () => {
  const OTHER_BUSINESS = '00000000-0000-0000-0000-0000000000c4'
  const sdk = new SynqedClient({ baseUrl: 'http://core.test', apiKey: TEST_API_KEY, businessId: TEST_BUSINESS_ID })
  beforeEach(() => {
    vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) =>
      app.request(String(url).replace('http://core.test', ''), init),
    )
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await cleanupInvites()
    await testPrisma.invite.deleteMany({ where: { businessId: OTHER_BUSINESS } })
  })

  it("throws 404 on another tenant's id and returns its own", async () => {
    const other = await testPrisma.invite.create({
      data: { businessId: OTHER_BUSINESS, email: 'o@example.com', role: 'STYLIST', token: 'f'.repeat(64) },
    })
    await expect(sdk.invites.get(other.id)).rejects.toMatchObject({ status: 404 })
    const mine = await sdk.invites.create({ email: 'm@example.com', role: 'STYLIST', token: 'g'.repeat(64) })
    expect(await sdk.invites.get(mine.id)).toEqual(mine)
  })

  it('encodes the id in the get path', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(url))
      return app.request(String(url).replace('http://core.test', ''), init)
    })
    await expect(sdk.invites.get('a/b')).rejects.toMatchObject({ status: 404 })
    expect(urls).toEqual(['http://core.test/v1/invites/a%2Fb'])
  })

  it('sends a zero page or page_size so core rejects it', async () => {
    await expect(sdk.invites.list({ page: 0 })).rejects.toMatchObject({ status: 400 })
    await expect(sdk.invites.list({ page_size: 0 })).rejects.toMatchObject({ status: 400 })
  })

  it('pages only when asked', async () => {
    await sdk.invites.create({ email: 'a@example.com', role: 'STYLIST', token: 'h'.repeat(64) })
    await sdk.invites.create({ email: 'b@example.com', role: 'STYLIST', token: 'i'.repeat(64) })
    expect(await sdk.invites.list()).not.toHaveProperty('total')
    const paged = await sdk.invites.list({ page_size: 1 })
    expect(paged).toMatchObject({ total: 2, page: 1, page_size: 1 })
    expect(paged.invites).toHaveLength(1)
  })
})
