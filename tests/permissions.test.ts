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
async function seedStore(name = '店') {
  return testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name } })
}

afterEach(async () => {
  await testPrisma.staffPermission.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.permissionVersion.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.staffStore.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.businessGrant.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('permissions — the one core-owned system', () => {
  it('rulebook serves the 8-role vocabulary; 主任 preset has NO stores.viewAll (8/18 ruling); accountant is money-only', async () => {
    const rb = await (await req('GET', '/permissions/rulebook')).json()
    expect(rb.roles).toContain('area_manager')
    expect(rb.roles).toContain('trainee')
    expect(rb.roles).toContain('accountant')
    expect(rb.presets.senior).not.toContain('stores.viewAll')
    expect(rb.presets.accountant).toEqual(['money.view'])
    expect(rb.presets.custom).toEqual([])
    expect(rb.presets.area_manager).not.toContain('stores.viewAll')
    expect(rb.rulebook_version).toBe(1)
  })

  it('unassigned staff fall back to the coarse label — nothing changes until Business writes', async () => {
    const stylist = await seedTestStaff({ role: 'STYLIST' })
    const sheet = await (await req('GET', `/permissions/answer-sheet?staff_id=${stylist.id}`)).json()
    expect(sheet.role).toBe('practitioner')
    expect(sheet.capabilities).toContain('records.write')
    expect(sheet.capabilities).not.toContain('staff.manage')
    expect(sheet.visible_store_ids).toBeNull() // no staff_stores rows = every store
    expect(sheet.version).toBe('1.1')
  })

  it('HQ-gated write: role assignment beats coarse label, bumps version, syncs the outer label; login-uuid identity accepted', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const s = await seedTestStaff({ name: 'S', role: 'STYLIST', userId: '99999999-0000-0000-0000-000000000071' })

    const denied = await req('PUT', `/permissions/staff/${s.id}`, {
      role: 'manager', acting_staff_id: s.id,
    })
    expect(denied.status).toBe(403)

    const saved = await (
      await req('PUT', `/permissions/staff/99999999-0000-0000-0000-000000000071`, {
        role: 'manager', acting_staff_id: owner.id,
        audit: { actor_id: owner.id, actor_type: 'staff', category: 'permission', action: 'role.assign', request_id: 'perm-1' },
      })
    ).json()
    expect(saved.role).toBe('manager')
    expect(saved.assigned).toBe(true)

    const sheet = await (await req('GET', `/permissions/answer-sheet?staff_id=${s.id}`)).json()
    expect(sheet.role).toBe('manager')
    expect(sheet.coarse_role).toBe('ADMIN')
    expect(sheet.capabilities).toContain('staff.manage')
    expect(sheet.visible_store_ids).toBeNull() // manager preset carries stores.viewAll
    expect(sheet.version).toBe('1.2') // bumped

    const staffRow = await testPrisma.staff.findUnique({ where: { id: s.id } })
    expect(staffRow?.role).toBe('ADMIN') // outer label synced

    const auditRows = await testPrisma.auditLog.findMany({
      where: { businessId: TEST_BUSINESS_ID, requestId: 'perm-1' },
    })
    expect(auditRows).toHaveLength(1)
  })

  it('overrides REPLACE the preset (empty array storable); recordings.viewAll self-heals off non-owners', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const s = await seedTestStaff({ name: 'T', role: 'STYLIST' })
    await req('PUT', `/permissions/staff/${s.id}`, {
      role: 'practitioner',
      overrides: ['customers.view', 'recordings.viewAll'], // smuggle attempt
      acting_staff_id: owner.id,
    })
    const sheet = await (await req('GET', `/permissions/answer-sheet?staff_id=${s.id}`)).json()
    expect(sheet.capabilities).toEqual(['customers.view']) // replaced + stripped

    // empty explicit override = zero capabilities, distinct from follow-preset
    await req('PUT', `/permissions/staff/${s.id}`, {
      role: 'practitioner', overrides: [], acting_staff_id: owner.id,
    })
    const zero = await (await req('GET', `/permissions/answer-sheet?staff_id=${s.id}`)).json()
    expect(zero.capabilities).toEqual([])

    const bad = await req('PUT', `/permissions/staff/${s.id}`, {
      role: 'practitioner', overrides: ['nope.cap'], acting_staff_id: owner.id,
    })
    expect(bad.status).toBe(400)
  })

  it('area_manager: requires a store list, sheet scopes to exactly it; accountant: money-only caps with money_scope all', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const am = await seedTestStaff({ name: 'AM', role: 'STYLIST' })
    const acct = await seedTestStaff({ name: '経理', role: 'ASSISTANT' })
    const a = await seedStore('A')
    const b = await seedStore('B')

    const noList = await req('PUT', `/permissions/staff/${am.id}`, {
      role: 'area_manager', acting_staff_id: owner.id,
    })
    expect(noList.status).toBe(400)

    await req('PUT', `/permissions/staff/${am.id}`, {
      role: 'area_manager', assigned_store_ids: [a.id, b.id], acting_staff_id: owner.id,
    })
    const amSheet = await (await req('GET', `/permissions/answer-sheet?staff_id=${am.id}`)).json()
    expect(amSheet.visible_store_ids?.sort()).toEqual([a.id, b.id].sort())
    expect(amSheet.capabilities).toContain('staff.manage') // store-manager rights
    expect(amSheet.capabilities).not.toContain('stores.viewAll')
    expect(amSheet.money_scope).toBeNull()

    await req('PUT', `/permissions/staff/${acct.id}`, {
      role: 'accountant', acting_staff_id: owner.id,
    })
    const acctSheet = await (await req('GET', `/permissions/answer-sheet?staff_id=${acct.id}`)).json()
    expect(acctSheet.capabilities).toEqual(['money.view'])
    expect(acctSheet.money_scope).toBe('all')

    // foreign store id rejected
    const badStore = await req('PUT', `/permissions/staff/${am.id}`, {
      role: 'area_manager', assigned_store_ids: ['00000000-0000-0000-0000-000000000099'], acting_staff_id: owner.id,
    })
    expect(badStore.status).toBe(400)
  })

  it('主任 sheet is own-store scoped via staff_stores; roster list mixes explicit and derived; version moves per write', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const chief = await seedTestStaff({ name: '主任', role: 'STYLIST' })
    const other = await seedTestStaff({ name: '一般', role: 'STYLIST' })
    const storeA = await seedStore('A')
    await testPrisma.staffStore.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: chief.id, storeId: storeA.id },
    })

    await req('PUT', `/permissions/staff/${chief.id}`, {
      role: 'senior', acting_staff_id: owner.id,
    })
    const sheet = await (await req('GET', `/permissions/answer-sheet?staff_id=${chief.id}`)).json()
    expect(sheet.role).toBe('senior')
    expect(sheet.visible_store_ids).toEqual([storeA.id]) // 8/18: own store only
    expect(sheet.capabilities).toContain('analytics.viewAll')
    expect(sheet.capabilities).not.toContain('stores.viewAll')

    const roster = await (await req('GET', '/permissions/staff')).json()
    const chiefRow = roster.assignments.find((r: { staff_id: string }) => r.staff_id === chief.id)
    const otherRow = roster.assignments.find((r: { staff_id: string }) => r.staff_id === other.id)
    expect(chiefRow.assigned).toBe(true)
    expect(otherRow.assigned).toBe(false)
    expect(otherRow.role).toBe('practitioner')
    expect(roster.version).toBe('1.2')
  })
})
