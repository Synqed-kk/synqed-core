import { describe, it, expect, afterEach, vi } from 'vitest'
import app from '../src/index.js'
import { SynqedClient, SynqedError } from '../packages/client/src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, seedTestKaruteRecord, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

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

const APPT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const APPT_B = 'bbbbbbbb-0000-4000-8000-000000000002'

let seq = 0
async function seedRecord() {
  const staff = await seedTestStaff()
  const customer = await seedTestCustomer({ email: `core58-${++seq}@ex.com` })
  const rec = await seedTestKaruteRecord({ staffId: staff.id, customerId: customer.id })
  return { staff, rec }
}

// The full persisted state a refused write must leave untouched: the record
// row, its entries, and its audit rows.
async function snapshotRecord(id: string) {
  return JSON.stringify({
    rec: await testPrisma.karuteRecord.findUnique({ where: { id } }),
    entries: await testPrisma.karuteEntry.findMany({ where: { karuteRecordId: id }, orderBy: { id: 'asc' } }),
    edits: await testPrisma.karuteEntryEdit.findMany({ where: { karuteRecordId: id }, orderBy: { id: 'asc' } }),
  })
}
async function snapshotOutcome(id: string) {
  return JSON.stringify(await testPrisma.karuteOutcome.findUnique({ where: { karuteRecordId: id } }))
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await testPrisma.karuteOutcome.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.karuteEntryEdit.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('CORE-58 PUT /karute-records/:id if_appointment_id_is', () => {
  it('a missing appointment_id key leaves the link; an explicit null clears it', async () => {
    const { rec } = await seedRecord()
    await req('PUT', `/karute-records/${rec.id}`, { appointment_id: APPT_A })
    const kept = await (await req('PUT', `/karute-records/${rec.id}`, { service: 'cut' })).json()
    expect(kept.appointment_id).toBe(APPT_A)
    const cleared = await (await req('PUT', `/karute-records/${rec.id}`, { appointment_id: null })).json()
    expect(cleared.appointment_id).toBeNull()
  })

  it('condition false (row is linked elsewhere) → 409 with current, nothing changes', async () => {
    const { staff, rec } = await seedRecord()
    await req('PUT', `/karute-records/${rec.id}`, {
      appointment_id: APPT_B,
      edited_summary: 'before',
      entries: [{ category: 'SYMPTOM', content: 'old' }],
      actor_staff_id: staff.id,
    })
    const before = await snapshotRecord(rec.id)

    const res = await req('PUT', `/karute-records/${rec.id}`, {
      if_appointment_id_is: null,
      appointment_id: APPT_A,
      service: 'changed',
      edited_summary: 'after',
      entries: [{ category: 'TREATMENT', content: 'new' }],
      actor_staff_id: staff.id,
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', field: 'appointment_id', current: APPT_B })
    expect(await snapshotRecord(rec.id)).toBe(before)
  })

  it('condition false against a different id → 409, current null when unlinked', async () => {
    const { rec } = await seedRecord()
    const before = await snapshotRecord(rec.id)
    const res = await req('PUT', `/karute-records/${rec.id}`, { if_appointment_id_is: APPT_A, appointment_id: null })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', field: 'appointment_id', current: null })
    expect(await snapshotRecord(rec.id)).toBe(before)
  })

  it('condition true → 200 with the ordinary body (null = still unlinked, then an id)', async () => {
    const { rec } = await seedRecord()
    const linkRes = await req('PUT', `/karute-records/${rec.id}`, {
      if_appointment_id_is: null,
      appointment_id: APPT_A,
      entries: [{ category: 'SYMPTOM', content: 'x' }],
    })
    expect(linkRes.status).toBe(200)
    const linked = await linkRes.json()
    expect(linked.appointment_id).toBe(APPT_A)
    expect(linked.entries.map((e: { content: string }) => e.content)).toEqual(['x'])

    const unlinkRes = await req('PUT', `/karute-records/${rec.id}`, { if_appointment_id_is: APPT_A, appointment_id: null })
    expect(unlinkRes.status).toBe(200)
    expect((await unlinkRes.json()).appointment_id).toBeNull()
  })

  it('a write that lands between the read and the conditional write → 409, row unchanged', async () => {
    const { rec } = await seedRecord()
    // Caller A reads: unlinked.
    const seen = (await (await req('GET', `/karute-records/${rec.id}`)).json()).appointment_id
    expect(seen).toBeNull()
    // Caller B links it meanwhile.
    await req('PUT', `/karute-records/${rec.id}`, { appointment_id: APPT_B })
    const before = await snapshotRecord(rec.id)
    // Caller A writes on what it saw.
    const res = await req('PUT', `/karute-records/${rec.id}`, { if_appointment_id_is: seen, appointment_id: APPT_A })
    expect(res.status).toBe(409)
    expect((await res.json()).current).toBe(APPT_B)
    expect(await snapshotRecord(rec.id)).toBe(before)
  })
})

describe('CORE-58 PUT /karute-outcomes if_not_decided', () => {
  const put = (id: string, body: Record<string, unknown>) =>
    req('PUT', '/karute-outcomes', { karute_record_id: id, ...body })

  it('no row → applies', async () => {
    const { staff, rec } = await seedRecord()
    const input = {
      outcome: 'success', reason: 'r', decision_context: 'conversion', is_first_visit: true,
      customer_id: rec.customerId, decided_by: staff.id, decided_at: '2026-09-01T10:00:00.000Z',
    }
    const res = await put(rec.id, { ...input, if_not_decided: true })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ karute_record_id: rec.id, ...input, auto_decided: false })
    // Same body the GET returns.
    expect(await (await req('GET', `/karute-outcomes/${rec.id}`)).json()).toEqual(body)
  })

  it('pending row → applies', async () => {
    const { rec } = await seedRecord()
    await put(rec.id, { outcome: 'pending' })
    const res = await put(rec.id, { outcome: 'no_deal', if_not_decided: true })
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('no_deal')
  })

  it('auto-decided row meeting a real staff answer → applies', async () => {
    const { rec } = await seedRecord()
    await put(rec.id, { outcome: 'no_deal', auto_decided: true })
    const res = await put(rec.id, { outcome: 'success', if_not_decided: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ outcome: 'success', auto_decided: false })
  })

  it('auto-decided row meeting pending → 409, unchanged', async () => {
    const { rec } = await seedRecord()
    await put(rec.id, { outcome: 'no_deal', auto_decided: true })
    const before = await snapshotOutcome(rec.id)
    const res = await put(rec.id, { outcome: 'pending', if_not_decided: true })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', field: 'outcome', current: 'no_deal' })
    expect(await snapshotOutcome(rec.id)).toBe(before)
  })

  it('staff-decided row → 409, unchanged', async () => {
    const { rec } = await seedRecord()
    await put(rec.id, { outcome: 'success' })
    const before = await snapshotOutcome(rec.id)
    const res = await put(rec.id, { outcome: 'no_deal', if_not_decided: true, auto_decided: true })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', field: 'outcome', current: 'success' })
    expect(await snapshotOutcome(rec.id)).toBe(before)
  })

  it('a decision that lands between the read and the conditional write → 409, row unchanged', async () => {
    const { rec } = await seedRecord()
    await put(rec.id, { outcome: 'pending' })
    // The cron reads: pending.
    expect((await (await req('GET', `/karute-outcomes/${rec.id}`)).json()).outcome).toBe('pending')
    // Staff answers meanwhile.
    await put(rec.id, { outcome: 'success' })
    const before = await snapshotOutcome(rec.id)
    // The cron's auto-close.
    const res = await put(rec.id, { outcome: 'no_deal', auto_decided: true, if_not_decided: true })
    expect(res.status).toBe(409)
    expect((await res.json()).current).toBe('success')
    expect(await snapshotOutcome(rec.id)).toBe(before)
  })

  it('field absent → today\'s overwrite', async () => {
    const { rec } = await seedRecord()
    await put(rec.id, { outcome: 'success' })
    const res = await put(rec.id, { outcome: 'pending' })
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('pending')
  })
})

describe('CORE-58 SDK', () => {
  it('sends the conditions and exposes the 409 body on SynqedError', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: 'conflict', field: 'outcome', current: 'success' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new SynqedClient({ baseUrl: 'http://core.test', apiKey: 'k', businessId: 'b' })

    const err = await client.karuteOutcomes
      .upsert({ karute_record_id: 'r', outcome: 'no_deal', if_not_decided: true })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SynqedError)
    expect((err as SynqedError).status).toBe(409)
    expect((err as SynqedError).body).toEqual({ error: 'conflict', field: 'outcome', current: 'success' })
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).if_not_decided).toBe(true)

    await client.karuteRecords.update('r', { if_appointment_id_is: null, appointment_id: 'a' }).catch(() => {})
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ if_appointment_id_is: null, appointment_id: 'a' })
  })
})

// A read-then-write version passes the sequential tests above. These hold the
// row lock in another session, send the conditional write while it waits, and
// change the row before the lock is released: only a check made BY the write
// sees the change.
async function whileRowLocked(lock: (tx: any) => Promise<unknown>, change: (tx: any) => Promise<unknown>, write: () => Promise<Response>) {
  let res!: Promise<Response>
  await testPrisma.$transaction(async (tx) => {
    await lock(tx)
    res = write()
    await new Promise(r => setTimeout(r, 300))
    await change(tx)
  }, { timeout: 10_000 })
  return res
}

describe('CORE-58 interleaved writes and tenant scope', () => {
  const OTHER_BUSINESS = '00000000-0000-0000-0000-0000000000b2'
  afterEach(() => testPrisma.karuteOutcome.deleteMany({ where: { businessId: OTHER_BUSINESS } }))

  it('records: a link committed while the conditional write waits → 409, the staff link stands', async () => {
    const { rec } = await seedRecord()
    const res = await whileRowLocked(
      tx => tx.$executeRaw`SELECT 1 FROM karute_records WHERE id = ${rec.id}::uuid FOR UPDATE`,
      tx => tx.karuteRecord.update({ where: { id: rec.id }, data: { appointmentId: APPT_B } }),
      () => req('PUT', `/karute-records/${rec.id}`, { appointment_id: APPT_A, if_appointment_id_is: null }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', field: 'appointment_id', current: APPT_B })
    expect((await testPrisma.karuteRecord.findUnique({ where: { id: rec.id } }))?.appointmentId).toBe(APPT_B)
  })

  it('outcomes: a staff answer committed while the job write waits → 409, the answer stands', async () => {
    const { rec } = await seedRecord()
    await testPrisma.karuteOutcome.create({ data: { karuteRecordId: rec.id, businessId: TEST_BUSINESS_ID, outcome: 'pending' } })
    const res = await whileRowLocked(
      tx => tx.$executeRaw`SELECT 1 FROM karute_outcomes WHERE karute_record_id = ${rec.id}::uuid FOR UPDATE`,
      tx => tx.karuteOutcome.update({ where: { karuteRecordId: rec.id }, data: { outcome: 'no_deal', autoDecided: false } }),
      () => req('PUT', '/karute-outcomes', { karute_record_id: rec.id, outcome: 'success', auto_decided: true, if_not_decided: true }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', field: 'outcome', current: 'no_deal' })
    expect((await testPrisma.karuteOutcome.findUnique({ where: { karuteRecordId: rec.id } }))?.outcome).toBe('no_deal')
  })

  it("outcomes: another business's row is neither written nor disclosed", async () => {
    const recordId = 'cccccccc-0000-4000-8000-000000000003'
    for (const outcome of ['pending', 'success']) {
      await testPrisma.karuteOutcome.upsert({
        where: { karuteRecordId: recordId },
        create: { karuteRecordId: recordId, businessId: OTHER_BUSINESS, outcome },
        update: { outcome },
      })
      const before = await snapshotOutcome(recordId)
      const res = await req('PUT', '/karute-outcomes', { karute_record_id: recordId, outcome: 'no_deal', if_not_decided: true })
      expect(res.status).toBe(404)
      expect(JSON.stringify(await res.json())).not.toContain('success')
      expect(await snapshotOutcome(recordId)).toBe(before)
    }
  })

  it('outcomes: a non-boolean if_not_decided is refused, not run unconditionally', async () => {
    const { rec } = await seedRecord()
    await testPrisma.karuteOutcome.create({ data: { karuteRecordId: rec.id, businessId: TEST_BUSINESS_ID, outcome: 'success' } })
    const before = await snapshotOutcome(rec.id)
    const res = await req('PUT', '/karute-outcomes', { karute_record_id: rec.id, outcome: 'pending', if_not_decided: 'true' })
    expect(res.status).toBe(400)
    expect(await snapshotOutcome(rec.id)).toBe(before)
  })
})
