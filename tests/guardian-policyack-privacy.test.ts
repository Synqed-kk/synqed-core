import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'
import { nameKey, sameName } from '../packages/client/src/privacy.js'

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

afterEach(async () => {
  await testPrisma.staffPolicyEvent.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('guardian model (msg-7 item 3)', () => {
  it('minor names a guardian; payer is a note; self/foreign guardians rejected', async () => {
    const parent = await seedTestCustomer({ email: 'parent@ex.com' })
    const minor = await (
      await req('POST', '/customers', {
        name: '子供 花子',
        guardian_customer_id: parent.id,
        payer_note: '母（会社経費ではない）',
      })
    ).json()
    expect(minor.guardian_customer_id).toBe(parent.id)
    expect(minor.payer_note).toContain('母')

    // self-guardian rejected on update
    const selfRes = await req('PUT', `/customers/${minor.id}`, {
      guardian_customer_id: minor.id,
    })
    expect(selfRes.status).toBe(400)

    // unknown guardian rejected on create
    const bad = await req('POST', '/customers', {
      name: 'X', guardian_customer_id: '00000000-0000-0000-0000-000000000042',
    })
    expect(bad.status).toBe(400)

    // guardian delete → SET NULL, minor's record survives
    await testPrisma.customerPhoto.deleteMany({ where: { customerId: parent.id } })
    await req('DELETE', `/customers/${parent.id}`)
    await testPrisma.customer.delete({ where: { id: parent.id } }).catch(() => null)
    const after = await testPrisma.customer.findUnique({ where: { id: minor.id } })
    expect(after).not.toBeNull()
  })
})

describe('policy-event ledger (msg-8 item 11)', () => {
  it('delivered → acknowledged → revoked lifecycle; ack-state answers the enablement question; queryable per version', async () => {
    const staff = await seedTestStaff({ userId: '99999999-0000-0000-0000-000000000081' })

    await req('POST', '/policy-events', {
      staff_id: staff.id, policy_line: 'recording', policy_version: 3, event: 'delivered',
    })
    let state = await (
      await req('GET', `/policy-events/ack-state?staff_id=${staff.id}&policy_line=recording&policy_version=3`)
    ).json()
    expect(state).toEqual({ delivered: true, acknowledged: false, revoked: false })

    // acknowledge via LOGIN uuid form — stored under the card
    await req('POST', '/policy-events', {
      staff_id: '99999999-0000-0000-0000-000000000081',
      policy_line: 'recording', policy_version: 3, event: 'acknowledged',
    })
    state = await (
      await req('GET', `/policy-events/ack-state?staff_id=${staff.id}&policy_line=recording&policy_version=3`)
    ).json()
    expect(state.acknowledged).toBe(true)

    await req('POST', '/policy-events', {
      staff_id: staff.id, policy_line: 'recording', policy_version: 3, event: 'revoked',
    })
    state = await (
      await req('GET', `/policy-events/ack-state?staff_id=${staff.id}&policy_line=recording&policy_version=3`)
    ).json()
    expect(state.acknowledged).toBe(false)
    expect(state.revoked).toBe(true)

    // per-version query: version 4 untouched
    const v4 = await (
      await req('GET', `/policy-events/ack-state?staff_id=${staff.id}&policy_line=recording&policy_version=4`)
    ).json()
    expect(v4).toEqual({ delivered: false, acknowledged: false, revoked: false })

    // no 'declined' exists — schema rejects it
    const declined = await req('POST', '/policy-events', {
      staff_id: staff.id, policy_line: 'recording', policy_version: 3, event: 'declined',
    })
    expect(declined.status).toBe(400)

    const list = await (
      await req('GET', `/policy-events?policy_line=recording&policy_version=3&event=acknowledged`)
    ).json()
    expect(list.events).toHaveLength(1)
  })
})

describe('privacy utils (msg-7 item 7)', () => {
  it('name comparison collapses spacing and width variants', () => {
    expect(sameName('青木陽菜', '青木 陽菜')).toBe(true)
    expect(sameName('青木陽菜', '青木　陽菜')).toBe(true) // ideographic space
    expect(nameKey('Ａｏｋｉ Ｈｉｎａ')).toBe(nameKey('aoki hina')) // full-width ASCII
    expect(nameKey('ｱｵｷ ﾋﾅ')).toBe(nameKey('アオキヒナ')) // half-width kana
    expect(sameName('青木陽菜', '青木陽子')).toBe(false)
  })
})
