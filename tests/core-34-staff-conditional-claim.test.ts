import { describe, it, expect, afterEach, vi } from 'vitest'
import app from '../src/index.js'
import { SynqedClient, SynqedError } from '../packages/client/src/index.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}
function put(id: string, body: unknown, business = TEST_BUSINESS_ID) {
  return app.request(`/v1/staff/${id}`, {
    method: 'PUT',
    headers: { ...headers, 'x-business-id': business },
    body: JSON.stringify(body),
  })
}

const USER_A = 'aaaaaaaa-3400-4000-8000-000000000001'
const USER_B = 'bbbbbbbb-3400-4000-8000-000000000002'
const OTHER_BUSINESS = '00000000-0000-0000-0000-0000000000b2'

const snapshot = async (id: string) => JSON.stringify(await testPrisma.staff.findUnique({ where: { id } }))
const conflict = (current: string | null) =>
  ({ error: 'conflict', code: 'STAFF_USER_ID_CONFLICT', field: 'user_id', current })

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupTestData()
})

describe('CORE-34 PUT /staff/:id if_user_id_is', () => {
  it('condition true → 200, the claim and the other fields are written', async () => {
    const staff = await seedTestStaff()
    const res = await put(staff.id, { if_user_id_is: null, user_id: USER_A, name: 'claimed' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: staff.id, user_id: USER_A, name: 'claimed' })
  })

  it('card already linked → named 409 with current, nothing changes', async () => {
    const staff = await seedTestStaff({ userId: USER_B })
    const before = await snapshot(staff.id)
    const res = await put(staff.id, { if_user_id_is: null, user_id: USER_A, name: 'changed' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual(conflict(USER_B))
    expect(await snapshot(staff.id)).toBe(before)
  })

  it('field absent → today\'s unconditional overwrite', async () => {
    const staff = await seedTestStaff({ userId: USER_B })
    const res = await put(staff.id, { user_id: USER_A })
    expect(res.status).toBe(200)
    expect((await res.json()).user_id).toBe(USER_A)
  })

  it("another business's card → 404, not written, not disclosed", async () => {
    const staff = await seedTestStaff({ userId: USER_B })
    const before = await snapshot(staff.id)
    const res = await put(staff.id, { if_user_id_is: USER_B, user_id: USER_A }, OTHER_BUSINESS)
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain(USER_B)
    expect(await snapshot(staff.id)).toBe(before)
  })

  it('two concurrent claims on one unwired card → one 200, one 409, one user_id', async () => {
    const staff = await seedTestStaff()
    const [a, b] = await Promise.all([
      put(staff.id, { if_user_id_is: null, user_id: USER_A }),
      put(staff.id, { if_user_id_is: null, user_id: USER_B }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const winner = a.status === 200 ? USER_A : USER_B
    expect((await (a.status === 409 ? a : b).json()).current).toBe(winner)
    expect((await testPrisma.staff.findUnique({ where: { id: staff.id } }))?.userId).toBe(winner)
  })
})

// A read-then-write version passes the sequential tests above. This holds the
// row lock in another session, sends the claim while it waits, and links the
// card before the lock is released: only a check made BY the write sees it.
async function untilAnotherSessionWaitsOnALock() {
  for (let i = 0; i < 100; i++) {
    const [{ n }] = await testPrisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`
    if (n > 0) return
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('the conditional write never blocked on the row lock')
}

describe('CORE-34 interleaved claim', () => {
  it('a link committed while the claim waits → 409, the first link stands', async () => {
    const staff = await seedTestStaff()
    let res!: Promise<Response>
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM staff WHERE id = ${staff.id}::uuid FOR UPDATE`
      res = put(staff.id, { if_user_id_is: null, user_id: USER_A })
      await untilAnotherSessionWaitsOnALock()
      await tx.staff.update({ where: { id: staff.id }, data: { userId: USER_B } })
    }, { timeout: 10_000 })
    const done = await res
    expect(done.status).toBe(409)
    expect(await done.json()).toEqual(conflict(USER_B))
    expect((await testPrisma.staff.findUnique({ where: { id: staff.id } }))?.userId).toBe(USER_B)
  })
})

describe('CORE-34 SDK', () => {
  it('sends if_user_id_is and exposes the named 409 on SynqedError', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(conflict(USER_B)), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: 'k', businessId: 'b' })
    const err = await client.staff.update('s', { if_user_id_is: null, user_id: USER_A }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SynqedError)
    expect((err as SynqedError).status).toBe(409)
    expect((err as SynqedError).code).toBe('STAFF_USER_ID_CONFLICT')
    expect((err as SynqedError).body).toEqual(conflict(USER_B))
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ if_user_id_is: null, user_id: USER_A })
  })
})
