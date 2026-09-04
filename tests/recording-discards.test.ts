import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestKaruteRecord,
  seedTestStaff,
  testPrisma,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

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
async function seedSession(staffId: string, customerId: string | null = null) {
  return testPrisma.recordingSession.create({
    data: { businessId: TEST_BUSINESS_ID, staffId, customerId, status: 'COMPLETED' },
  })
}

afterEach(async () => {
  await testPrisma.recordingDiscardEvent.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.recordingSession.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('recording discard events', () => {
  it('staff discard requires a written reason and an actor; login-uuid resolves to the card', async () => {
    const staff = await seedTestStaff({ userId: '99999999-0000-0000-0000-000000000051' })
    const session = await seedSession(staff.id)

    for (const bad of [
      { recording_session_id: session.id, source: 'STAFF', discarded_by: staff.id }, // no reason
      { recording_session_id: session.id, source: 'STAFF', discarded_by: staff.id, reason: '   ' }, // blank
      { recording_session_id: session.id, source: 'STAFF', reason: '録音に個人情報が誤って入った' }, // no actor
    ]) {
      expect((await req('POST', '/recording-discards', bad)).status).toBe(400)
    }

    const ok = await req('POST', '/recording-discards', {
      recording_session_id: session.id,
      source: 'STAFF',
      discarded_by: '99999999-0000-0000-0000-000000000051', // login form in
      reason: '  お客様の同意が取れていなかったため破棄  ',
    })
    expect(ok.status).toBe(201)
    const event = await ok.json()
    expect(event.recording_session_id).toBe(session.id)
    expect(event.karute_record_id).toBeNull()
    expect(event.discarded_by).toBe(staff.id) // card stored
    expect(event.reason).toBe('お客様の同意が取れていなかったため破棄') // trimmed
    expect(event.id).toBeTruthy() // the audit-detail handle
  })

  it('persists a written staff reason against a karute record when no session exists', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const karuteRecord = await seedTestKaruteRecord({ customerId: customer.id, staffId: staff.id })

    for (const missingKey of [
      { source: 'STAFF', discarded_by: staff.id, reason: '記録前に破棄' },
      {
        recording_session_id: null,
        karute_record_id: null,
        source: 'STAFF',
        discarded_by: staff.id,
        reason: '記録前に破棄',
      },
    ]) {
      expect((await req('POST', '/recording-discards', missingKey)).status).toBe(400)
    }

    const response = await req('POST', '/recording-discards', {
      karute_record_id: karuteRecord.id,
      source: 'STAFF',
      discarded_by: staff.id,
      reason: '  セッション作成前に破棄したため  ',
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      recording_session_id: null,
      karute_record_id: karuteRecord.id,
      discarded_by: staff.id,
      reason: 'セッション作成前に破棄したため',
    })
  })

  it('system cleanup rows carry no reason and no actor — and reject both', async () => {
    const staff = await seedTestStaff()
    const session = await seedSession(staff.id)
    expect((await req('POST', '/recording-discards', {
      recording_session_id: session.id, source: 'SYSTEM', reason: 'cleanup',
    })).status).toBe(400)
    expect((await req('POST', '/recording-discards', {
      recording_session_id: session.id, source: 'SYSTEM', discarded_by: staff.id,
    })).status).toBe(400)

    const ok = await (await req('POST', '/recording-discards', {
      recording_session_id: session.id, source: 'SYSTEM',
    })).json()
    expect(ok.source).toBe('SYSTEM')
    expect(ok.reason).toBeNull()
    expect(ok.discarded_by).toBeNull()
  })

  it('the ledger outlives the hard-deleted session; list filters by session and source', async () => {
    const staff = await seedTestStaff()
    const customer = await seedTestCustomer()
    const s1 = await seedSession(staff.id, customer.id)
    const s2 = await seedSession(staff.id)

    await req('POST', '/recording-discards', {
      recording_session_id: s1.id, source: 'STAFF', discarded_by: staff.id, reason: '誤録音のため',
    })
    await req('POST', '/recording-discards', { recording_session_id: s2.id, source: 'SYSTEM' })

    // hard-delete s1 via the real endpoint — the discard row must survive
    await req('DELETE', `/recordings/${s1.id}`)
    expect(await testPrisma.recordingSession.findUnique({ where: { id: s1.id } })).toBeNull()

    const bySession = await (
      await req('GET', `/recording-discards?recording_session_id=${s1.id}`)
    ).json()
    expect(bySession.total).toBe(1)
    expect(bySession.events[0].reason).toBe('誤録音のため')

    const staffOnly = await (await req('GET', '/recording-discards?source=STAFF')).json()
    expect(staffOnly.total).toBe(1)
    const all = await (await req('GET', '/recording-discards')).json()
    expect(all.total).toBe(2)
  })
})
