import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

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

describe('business grants (HQ_ADMIN)', () => {
  afterEach(async () => {
    await testPrisma.businessGrant.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
    await cleanupTestData()
  })

  it('OWNER grants; grantee passes /check; STYLIST cannot grant', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const manager = await seedTestStaff({ name: 'HQ担当', role: 'ADMIN' })
    const stylist = await seedTestStaff({ name: '一般', role: 'STYLIST' })

    // stylist blocked from granting
    const forbidden = await req('POST', '/business-grants', {
      staff_id: stylist.id, grant: 'HQ_ADMIN', acting_staff_id: stylist.id,
    })
    expect(forbidden.status).toBe(403)

    // owner grants
    const granted = await req('POST', '/business-grants', {
      staff_id: manager.id, grant: 'HQ_ADMIN', acting_staff_id: owner.id,
    })
    expect(granted.status).toBe(201)

    const check = await (await req('GET', `/business-grants/check?staff_id=${manager.id}`)).json()
    expect(check.granted).toBe(true)
    const notGranted = await (await req('GET', `/business-grants/check?staff_id=${stylist.id}`)).json()
    expect(notGranted.granted).toBe(false)
  })

  it('an HQ_ADMIN (non-owner) can grant others; revoke is soft and removes the capability', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const a = await seedTestStaff({ name: 'A', role: 'ADMIN' })
    const b = await seedTestStaff({ name: 'B', role: 'ADMIN' })

    const ga = await (
      await req('POST', '/business-grants', { staff_id: a.id, grant: 'HQ_ADMIN', acting_staff_id: owner.id })
    ).json()
    // a (now HQ_ADMIN, not owner) grants b
    const gb = await req('POST', '/business-grants', {
      staff_id: b.id, grant: 'HQ_ADMIN', acting_staff_id: a.id,
    })
    expect(gb.status).toBe(201)

    // revoke a — row survives with revoked_at, capability gone
    const rev = await req('DELETE', `/business-grants/${ga.id}?acting_staff_id=${owner.id}`)
    expect((await rev.json()).ok).toBe(true)
    const row = await testPrisma.businessGrant.findUnique({ where: { id: ga.id } })
    expect(row?.revokedAt).not.toBeNull()
    expect((await (await req('GET', `/business-grants/check?staff_id=${a.id}`)).json()).granted).toBe(false)

    // list shows only live grants
    const list = await (await req('GET', '/business-grants')).json()
    expect(list.grants.map((g: { staff_id: string }) => g.staff_id)).toEqual([b.id])
  })

  it('re-grant is idempotent on the live row; regrant after revoke mints a new row; login-uuid identity form works', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const m = await seedTestStaff({
      name: 'M', role: 'ADMIN', userId: '99999999-0000-0000-0000-000000000031',
    })
    const g1 = await (
      await req('POST', '/business-grants', { staff_id: m.id, grant: 'HQ_ADMIN', acting_staff_id: owner.id })
    ).json()
    const g2 = await (
      await req('POST', '/business-grants', { staff_id: m.id, grant: 'HQ_ADMIN', acting_staff_id: owner.id })
    ).json()
    expect(g2.id).toBe(g1.id)

    // capability probe accepts the LOGIN uuid form too
    const byLogin = await (
      await req('GET', '/business-grants/check?staff_id=99999999-0000-0000-0000-000000000031')
    ).json()
    expect(byLogin.granted).toBe(true)

    await req('DELETE', `/business-grants/${g1.id}?acting_staff_id=${owner.id}`)
    const g3 = await (
      await req('POST', '/business-grants', { staff_id: m.id, grant: 'HQ_ADMIN', acting_staff_id: owner.id })
    ).json()
    expect(g3.id).not.toBe(g1.id)
  })
})
