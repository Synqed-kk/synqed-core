import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import app from '../src/index.js'
import { SynqedClient } from '../packages/client/src/client.js'
import { cleanupTestData, seedTestStaff, seedTestKaruteRecord, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const foreignBusiness = randomUUID()
const headers = { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID }
const get = (path: string) => app.request(`/v1${path}`, { headers })

afterEach(async () => {
  vi.unstubAllGlobals()
  await testPrisma.recordingDiscardEvent.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
  await testPrisma.karuteOutcome.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, foreignBusiness] } } })
  await cleanupTestData()
})

describe('CORE-4 read filters', () => {
  it('pages equal-timestamp discard and outcome rows by their ID tie-breaker', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort()
    const time = new Date('2026-09-01T00:00:00Z')
    const staff = await seedTestStaff()
    // Insert opposite to the promised order so timestamp ordering alone does
    // not accidentally prove this contract through insertion order.
    for (const id of ids) await testPrisma.recordingDiscardEvent.create({ data: {
      id, businessId: TEST_BUSINESS_ID, recordingSessionId: randomUUID(), source: 'SYSTEM', createdAt: time,
    } })
    for (const id of [...ids].reverse()) {
      await testPrisma.karuteRecord.create({ data: { id, businessId: TEST_BUSINESS_ID, staffId: staff.id } })
      await testPrisma.karuteOutcome.create({ data: { karuteRecordId: id, businessId: TEST_BUSINESS_ID, outcome: 'success', updatedAt: time } })
    }
    for (let repeat = 0; repeat < 2; repeat++) {
      const discards: string[] = [], outcomes: string[] = []
      for (let page = 1; page <= 3; page++) {
        const discard = await (await get(`/recording-discards?page_size=1&page=${page}`)).json()
        const outcome = await (await get(`/karute-outcomes?staff_id=${staff.id}&page_size=1&page=${page}`)).json()
        expect(discard.total).toBe(3)
        expect(outcome.total).toBe(3)
        discards.push(discard.events[0].id)
        outcomes.push(outcome.outcomes[0].karute_record_id)
      }
      expect(discards).toEqual([...ids].reverse())
      expect(outcomes).toEqual(ids)
    }
  })

  it('carries the new filters through the SDK without turning an empty set into an unfiltered read', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ events: [], outcomes: [], total: 0, page: 1, page_size: 100 }))
    vi.stubGlobal('fetch', fetch)
    const client = new SynqedClient({ baseUrl: 'https://core.test/v1', apiKey: 'test', businessId: TEST_BUSINESS_ID })
    const a = randomUUID(), b = randomUUID()
    await client.recordingDiscards.list({ recording_session_ids: [a, b], created_from: '2026-09-01T00:00:00Z', created_before: '2026-09-02T00:00:00Z' })
    const discard = new URL(String(fetch.mock.calls[0][0]))
    expect(discard.searchParams.get('recording_session_ids')).toBe(`${a},${b}`)
    expect(discard.searchParams.get('created_from')).toBe('2026-09-01T00:00:00Z')
    expect(discard.searchParams.get('created_before')).toBe('2026-09-02T00:00:00Z')
    await client.recordingDiscards.list({ recording_session_ids: [] })
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.has('recording_session_ids')).toBe(true)
    await client.karuteOutcomes.list({ staff_id: a, karute_record_id: b })
    const outcome = new URL(String(fetch.mock.calls[2][0]))
    expect(outcome.searchParams.get('staff_id')).toBe(a)
    expect(outcome.searchParams.get('karute_record_id')).toBe(b)
  })
  it('intersects session sets, source and a half-open discard date range before pagination', async () => {
    const a = randomUUID(), b = randomUUID(), c = randomUUID()
    for (const [session, date, businessId] of [
      [a, '2026-09-01T00:00:00Z', TEST_BUSINESS_ID],
      [b, '2026-09-01T12:00:00Z', TEST_BUSINESS_ID],
      [a, '2026-09-02T00:00:00Z', TEST_BUSINESS_ID],
      [c, '2026-09-01T12:00:00Z', TEST_BUSINESS_ID],
      [a, '2026-09-01T12:00:00Z', foreignBusiness],
    ]) await testPrisma.recordingDiscardEvent.create({ data: { businessId, recordingSessionId: session, source: 'SYSTEM', createdAt: new Date(date) } })
    const path = `/recording-discards?recording_session_ids=${a},${b}&source=SYSTEM&created_from=2026-09-01T00:00:00Z&created_before=2026-09-02T00:00:00Z&page_size=1`
    const first = await get(path)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ total: 2, page: 1, events: [{ recording_session_id: b }] })
    expect(await (await get(`${path}&page=2`)).json()).toMatchObject({ total: 2, events: [{ recording_session_id: a }] })
  })

  it('rejects malformed or ambiguous filters rather than widening the query', async () => {
    for (const query of [
      'recording_session_ids=', 'recording_session_ids=bad',
      `recording_session_ids=${randomUUID()}&recording_session_id=${randomUUID()}`,
      'created_from=not-a-date', 'created_before=2026-09-01',
      'created_from=2026-09-02T00:00:00Z&created_before=2026-09-01T00:00:00Z',
    ]) expect((await get(`/recording-discards?${query}`)).status).toBe(400)
    for (const query of ['staff_id=bad', 'karute_record_id=bad']) {
      expect((await get(`/karute-outcomes?${query}`)).status).toBe(400)
    }
  })

  it('filters outcomes by the record’s staff, not its deciding actor, within the business', async () => {
    const a = await seedTestStaff(), b = await seedTestStaff()
    const one = await seedTestKaruteRecord({ staffId: a.id })
    const two = await seedTestKaruteRecord({ staffId: b.id })
    for (const [record, decidedBy] of [[one, b.id], [two, a.id]] as const) {
      await testPrisma.karuteOutcome.create({ data: { businessId: TEST_BUSINESS_ID, karuteRecordId: record.id, decidedBy, outcome: 'success' } })
    }
    const filtered = await get(`/karute-outcomes?staff_id=${a.id}&outcome=success&page_size=1`)
    expect(filtered.status).toBe(200)
    expect(await filtered.json()).toMatchObject({ total: 1, outcomes: [{ karute_record_id: one.id }] })
    expect(await (await get(`/karute-outcomes?staff_id=${a.id}&karute_record_id=${two.id}`)).json()).toMatchObject({ total: 0, outcomes: [] })
    expect(await (await get(`/karute-outcomes?karute_record_id=${two.id}`)).json()).toMatchObject({ total: 1, outcomes: [{ karute_record_id: two.id }] })
    await testPrisma.karuteOutcome.update({ where: { karuteRecordId: one.id }, data: { businessId: foreignBusiness } })
    expect(await (await get(`/karute-outcomes?staff_id=${a.id}`)).json()).toMatchObject({ total: 0, outcomes: [] })
  })
})
