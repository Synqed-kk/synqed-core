import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { multiplierFor } from '../src/services/pricing.service.js'
import {
  cleanupTestData,
  seedTestCustomer,
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

async function seedStore() {
  return testPrisma.store.create({ data: { businessId: TEST_BUSINESS_ID, name: '店' } })
}
async function seedMenu(over?: Record<string, unknown>) {
  return testPrisma.menu.create({
    data: {
      businessId: TEST_BUSINESS_ID,
      name: 'カット',
      durationMinutes: 60,
      priceListAmount: 10000,
      priceMinAmount: 7000,
      ...over,
    },
  })
}

afterEach(async () => {
  await testPrisma.pricingRuleSet.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.businessGrant.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await testPrisma.store.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('pricing rules — versioning + guard', () => {
  it('HQ gate: STYLIST 403s, OWNER saves; save supersedes; history linear; rollback re-issues', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const stylist = await seedTestStaff({ name: '一般', role: 'STYLIST' })
    const store = await seedStore()

    const denied = await req('POST', '/pricing-rules', {
      store_id: store.id, rules: { grid: { mon: { '10': 1.2 } } }, acting_staff_id: stylist.id,
    })
    expect(denied.status).toBe(403)

    const v1 = await (
      await req('POST', '/pricing-rules', {
        store_id: store.id, rules: { grid: { mon: { '10': 1.2 } } }, acting_staff_id: owner.id,
      })
    ).json()
    expect(v1.version).toBe(1)
    const v2 = await (
      await req('POST', '/pricing-rules', {
        store_id: store.id, rules: { grid: { mon: { '10': 0.9 } } }, acting_staff_id: owner.id,
      })
    ).json()
    expect(v2.version).toBe(2)

    const active = await (await req('GET', `/pricing-rules/active?store_id=${store.id}`)).json()
    expect(active.rule_sets).toHaveLength(1)
    expect(active.rule_sets[0].version).toBe(2)

    const hist = await (await req('GET', `/pricing-rules/history?store_id=${store.id}`)).json()
    expect(hist.rule_sets.map((r: { version: number }) => r.version)).toEqual([2, 1])

    // rollback to v1 mints v3 with v1's rules
    const v3 = await (
      await req('POST', `/pricing-rules/${v1.id}/rollback`, { acting_staff_id: owner.id })
    ).json()
    expect(v3.version).toBe(3)
    expect(v3.rules.grid.mon['10']).toBe(1.2)
    const nowActive = await (await req('GET', `/pricing-rules/active?store_id=${store.id}`)).json()
    expect(nowActive.rule_sets[0].id).toBe(v3.id)
  })

  it('rejects malformed rules (bad hour key, multiplier out of band, inverted promo)', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const store = await seedStore()
    for (const rules of [
      { grid: { mon: { '24': 1.1 } } },
      { grid: { mon: { '10': 9 } } },
      { promos: [{ from: '2026-08-10', to: '2026-08-01', multiplier: 1.1 }] },
    ]) {
      const res = await req('POST', '/pricing-rules', {
        store_id: store.id, rules, acting_staff_id: owner.id,
      })
      expect(res.status).toBe(400)
    }
  })
})

describe('multiplierFor — JST resolution', () => {
  const rules = {
    grid: { fri: { '18': 1.3 }, sat: { '0': 1.7, '10': 1.5 } },
    promos: [{ from: '2026-08-10', to: '2026-08-12', multiplier: 0.8 }],
  }
  it('grid uses the JST weekday and hour, not UTC', () => {
    // 2026-08-07 is a Friday. 18:00 JST = 09:00 UTC same day.
    expect(multiplierFor(rules, new Date('2026-08-07T09:00:00Z'))).toBe(1.3)
    // Sat 00:30 JST = Fri 15:30 UTC — the UTC weekday would miss this one.
    expect(multiplierFor(rules, new Date('2026-08-07T15:30:00Z'))).toBe(1.7)
    // Sat 10:00 JST = Sat 01:00 UTC
    expect(multiplierFor(rules, new Date('2026-08-08T01:00:00Z'))).toBe(1.5)
    // unlisted hour → 1.0
    expect(multiplierFor(rules, new Date('2026-08-07T03:00:00Z'))).toBe(1)
  })
  it('promo date (JST) takes precedence over the grid', () => {
    // 2026-08-10T23:00Z = Aug 11 08:00 JST → inside promo
    expect(multiplierFor(rules, new Date('2026-08-10T23:00:00Z'))).toBe(0.8)
    // 2026-08-09T14:59Z = Aug 9 23:59 JST → before promo
    expect(multiplierFor(rules, new Date('2026-08-09T14:59:00Z'))).toBe(1)
  })
})

describe('server-side price of record at booking create', () => {
  it('computes from rules, clamps to the band, and ignores the client price', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const customer = await seedTestCustomer()
    const store = await seedStore()
    const menu = await seedMenu() // list 10000, floor 7000

    await req('POST', '/pricing-rules', {
      store_id: store.id,
      menu_id: menu.id,
      // Friday 18:00 JST → 0.5 would be 5000, below floor → clamps to 7000
      rules: { grid: { fri: { '18': 0.5 }, sat: { '10': 2.0 } } },
      acting_staff_id: owner.id,
    })

    // Friday 18:00 JST = 09:00Z — floor clamp
    const a = await (
      await req('POST', '/appointments', {
        customer_id: customer.id, staff_id: owner.id, store_id: store.id,
        starts_at: '2026-08-07T09:00:00.000Z', ends_at: '2026-08-07T10:00:00.000Z',
        menu_id: menu.id,
        booked_price_amount: 99999, // client lies — must be ignored
        booked_price_currency: 'USD',
      })
    ).json()
    expect(a.booked_price_amount).toBe(7000)
    expect(a.booked_price_currency).toBe('JPY')

    // Saturday 10:00 JST = Fri 01:00Z — 2.0 would be 20000, above ceiling → 10000
    const b = await (
      await req('POST', '/appointments', {
        customer_id: customer.id, staff_id: owner.id, store_id: store.id,
        starts_at: '2026-08-08T01:00:00.000Z', ends_at: '2026-08-08T02:00:00.000Z',
        menu_id: menu.id,
      })
    ).json()
    expect(b.booked_price_amount).toBe(10000)
  })

  it('store-default set applies when no menu-specific set exists; no rules → list price; menu-less keeps caller values', async () => {
    const owner = await seedTestStaff({ role: 'OWNER' })
    const customer = await seedTestCustomer()
    const store = await seedStore()
    const menu = await seedMenu()

    // no rules → computed = list; a lowball client price clamps UP to the floor
    const plain = await (
      await req('POST', '/appointments', {
        customer_id: customer.id, staff_id: owner.id, store_id: store.id,
        starts_at: '2026-08-10T01:00:00.000Z', ends_at: '2026-08-10T02:00:00.000Z',
        menu_id: menu.id, booked_price_amount: 1,
      })
    ).json()
    expect(plain.booked_price_amount).toBe(7000)

    // an agreed discount WITHIN [floor, computed] is honored (#55 design kept)
    const agreed = await (
      await req('POST', '/appointments', {
        customer_id: customer.id, staff_id: owner.id, store_id: store.id,
        starts_at: '2026-08-10T03:00:00.000Z', ends_at: '2026-08-10T04:00:00.000Z',
        menu_id: menu.id, booked_price_amount: 8500,
      })
    ).json()
    expect(agreed.booked_price_amount).toBe(8500)

    // store-default (menu null) covers all menus
    await req('POST', '/pricing-rules', {
      store_id: store.id, rules: { grid: { tue: { '10': 0.8 } } }, acting_staff_id: owner.id,
    })
    // 2026-08-11 is a Tuesday; 10:00 JST = 01:00Z
    const withDefault = await (
      await req('POST', '/appointments', {
        customer_id: customer.id, staff_id: owner.id, store_id: store.id,
        starts_at: '2026-08-11T01:00:00.000Z', ends_at: '2026-08-11T02:00:00.000Z',
        menu_id: menu.id,
      })
    ).json()
    expect(withDefault.booked_price_amount).toBe(8000)

    // menu-less booking keeps the caller's values (legacy path unchanged)
    const legacy = await (
      await req('POST', '/appointments', {
        customer_id: customer.id, staff_id: owner.id, store_id: store.id,
        starts_at: '2026-08-12T01:00:00.000Z', ends_at: '2026-08-12T02:00:00.000Z',
        booked_price_amount: 4321, booked_price_currency: 'JPY',
      })
    ).json()
    expect(legacy.booked_price_amount).toBe(4321)

    // unknown menu 404s
    const bad = await req('POST', '/appointments', {
      customer_id: customer.id, staff_id: owner.id, store_id: store.id,
      starts_at: '2026-08-13T01:00:00.000Z', ends_at: '2026-08-13T02:00:00.000Z',
      menu_id: '00000000-0000-0000-0000-000000000042',
    })
    expect(bad.status).toBe(404)
  })
})
