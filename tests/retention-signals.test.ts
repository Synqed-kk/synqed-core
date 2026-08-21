import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, seedTestKaruteRecord, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
process.env.CRON_SECRET = 'test-cron-secret'
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

let seq = 0
async function seedTriple() {
  const staff = await seedTestStaff()
  const customer = await seedTestCustomer({ email: `rs-${++seq}@ex.com` })
  const rec = await seedTestKaruteRecord({ staffId: staff.id, customerId: customer.id })
  return { staff, customer, rec }
}
function signalBody(t: { staff: { id: string }; customer: { id: string }; rec: { id: string } }, over: Record<string, unknown> = {}) {
  return {
    occurred_at: '2026-08-19T10:00:00.000Z',
    karute_record_id: t.rec.id,
    customer_id: t.customer.id,
    staff_id: t.staff.id,
    criterion: 'A',
    confidence: 'high',
    quote: 'うちのサロンに来ない？今より稼げるよ',
    ...over,
  }
}

afterEach(async () => {
  await testPrisma.retentionSignal.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.retentionSignalDismissal.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('retention signals', () => {
  it('create → pending with a 14-day TTL; schema walls hold (no extra fields, empty quote 400)', async () => {
    const t = await seedTriple()
    const res = await req('POST', '/retention-signals', signalBody(t))
    expect(res.status).toBe(201)
    const row = await res.json()
    expect(row.status).toBe('pending')
    const ttlDays = (Date.parse(row.expires_at) - Date.now()) / 86_400_000
    expect(ttlDays).toBeGreaterThan(13.9)
    expect(ttlDays).toBeLessThan(14.1)

    expect((await req('POST', '/retention-signals', signalBody(t, { quote: '  ' }))).status).toBe(400)
    expect((await req('POST', '/retention-signals', signalBody(t, { criterion: 'D' }))).status).toBe(400)
  })

  it('confirm stamps manager (card id from login form) + 1y clock; idempotent', async () => {
    const t = await seedTriple()
    const manager = await seedTestStaff({ name: '店長', userId: '99999999-0000-0000-0000-000000000061' })
    const { id } = await (await req('POST', '/retention-signals', signalBody(t))).json()

    const confirmed = await (
      await req('POST', `/retention-signals/${id}/confirm`, {
        manager_staff_id: '99999999-0000-0000-0000-000000000061',
      })
    ).json()
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.confirmed_by).toBe(manager.id)
    const clockDays = (Date.parse(confirmed.expires_at) - Date.now()) / 86_400_000
    expect(clockDays).toBeGreaterThan(364)

    const again = await (
      await req('POST', `/retention-signals/${id}/confirm`, { manager_staff_id: manager.id })
    ).json()
    expect(again.confirmed_at).toBe(confirmed.confirmed_at)
  })

  it('dismiss HARD-deletes and leaves only the anonymized counter', async () => {
    const t = await seedTriple()
    const { id } = await (
      await req('POST', '/retention-signals', signalBody(t, { criterion: 'B', confidence: 'medium' }))
    ).json()
    expect((await (await req('POST', `/retention-signals/${id}/dismiss`)).json()).ok).toBe(true)

    expect(await testPrisma.retentionSignal.findUnique({ where: { id } })).toBeNull() // gone for real
    const counters = await (await req('GET', '/retention-signals/dismissal-counters')).json()
    expect(counters.counters).toEqual([{ criterion: 'B', confidence: 'medium', count: 1 }])
    // counter row carries nothing identifying
    const raw = await testPrisma.retentionSignalDismissal.findFirst({ where: { businessId: TEST_BUSINESS_ID } })
    expect(Object.keys(raw!)).toEqual(['id', 'businessId', 'criterion', 'confidence', 'dismissedAt'])
  })

  it('statutory delete leaves NO counter; customer hard-delete cascades the signal (scrub inclusion)', async () => {
    const t = await seedTriple()
    const { id } = await (await req('POST', '/retention-signals', signalBody(t))).json()
    expect((await (await req('DELETE', `/retention-signals/${id}`)).json()).ok).toBe(true)
    expect(await testPrisma.retentionSignalDismissal.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)

    const t2 = await seedTriple()
    await req('POST', '/retention-signals', signalBody(t2))
    await testPrisma.karuteRecord.deleteMany({ where: { id: t2.rec.id } })
    await testPrisma.customer.delete({ where: { id: t2.customer.id } })
    expect(
      await testPrisma.retentionSignal.count({ where: { customerId: t2.customer.id } }),
    ).toBe(0)
  })

  it('cron sweep erases past-expiry rows of BOTH statuses; CRON_SECRET enforced', async () => {
    const t = await seedTriple()
    const a = await (await req('POST', '/retention-signals', signalBody(t))).json()
    const b = await (await req('POST', '/retention-signals', signalBody(t, { criterion: 'C' }))).json()
    await req('POST', `/retention-signals/${b.id}/confirm`, { manager_staff_id: t.staff.id })
    // age both past their clocks
    await testPrisma.retentionSignal.updateMany({
      where: { businessId: TEST_BUSINESS_ID },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const noAuth = await app.request('/v1/retention-signals/cron/sweep')
    expect(noAuth.status).toBe(401)
    const swept = await (
      await app.request('/v1/retention-signals/cron/sweep', {
        headers: { authorization: 'Bearer test-cron-secret' },
      })
    ).json()
    expect(swept.deleted).toBeGreaterThanOrEqual(2)
    expect(await testPrisma.retentionSignal.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
    void a
  })
})
