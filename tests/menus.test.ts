import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
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

describe('Menus — the bookable catalog', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('creates and lists a menu with band pricing', async () => {
    const res = await req('POST', '/menus', {
      name: '60分整体',
      duration_minutes: 60,
      price_list_amount: 17600,
      price_min_amount: 11792,
      category: '都度払い',
    })
    expect(res.status).toBe(201)
    const menu = await res.json()
    expect(menu.price_list_amount).toBe(17600)
    expect(menu.price_min_amount).toBe(11792)
    expect(menu.currency).toBe('JPY')
    expect(menu.tax_included).toBe(true)
    expect(menu.active).toBe(true)

    const list = await (await req('GET', '/menus')).json()
    expect(list.menus).toHaveLength(1)
    expect(list.menus[0].name).toBe('60分整体')
  })

  it('400 when the band inverts on create (min > list)', async () => {
    const res = await req('POST', '/menus', {
      name: 'x',
      duration_minutes: 60,
      price_list_amount: 10000,
      price_min_amount: 12000,
    })
    expect(res.status).toBe(400)
  })

  it('400 when a partial update inverts the band against effective values', async () => {
    const created = await (
      await req('POST', '/menus', {
        name: 'x',
        duration_minutes: 60,
        price_list_amount: 10000,
        price_min_amount: 8000,
      })
    ).json()
    // Lower the list BELOW the existing floor — only one side in the input.
    const res = await req('PATCH', `/menus/${created.id}`, { price_list_amount: 7000 })
    expect(res.status).toBe(400)
  })

  it('store filter returns the store menus PLUS all-store menus', async () => {
    const storeId = '00000000-0000-0000-0000-0000000000f1'
    await req('POST', '/menus', { name: '全店共通', duration_minutes: 60, price_list_amount: 5000 })
    await req('POST', '/menus', { name: '店舗限定', duration_minutes: 30, price_list_amount: 3000, store_id: storeId })
    await req('POST', '/menus', {
      name: '他店限定',
      duration_minutes: 30,
      price_list_amount: 3000,
      store_id: '00000000-0000-0000-0000-0000000000f2',
    })

    const list = await (await req('GET', `/menus?store_id=${storeId}`)).json()
    const names = list.menus.map((m: { name: string }) => m.name).sort()
    expect(names).toEqual(['全店共通', '店舗限定'])
  })

  it('retires via active:false — no DELETE route exists', async () => {
    const created = await (
      await req('POST', '/menus', { name: 'x', duration_minutes: 60, price_list_amount: 5000 })
    ).json()
    const patched = await (await req('PATCH', `/menus/${created.id}`, { active: false })).json()
    expect(patched.active).toBe(false)

    const activeOnly = await (await req('GET', '/menus?active=true')).json()
    expect(activeOnly.menus).toHaveLength(0)

    const del = await req('DELETE', `/menus/${created.id}`)
    expect(del.status).toBe(404)
  })

  it('menus are business-scoped', async () => {
    const created = await (
      await req('POST', '/menus', { name: 'x', duration_minutes: 60, price_list_amount: 5000 })
    ).json()
    const res = await app.request(`/v1/menus/${created.id}`, {
      method: 'GET',
      headers: { ...headers, 'x-business-id': '00000000-0000-0000-0000-000000000099' },
    })
    expect(res.status).toBe(404)
  })

  it('appointment persists the booked-menu snapshot', async () => {
    const customer = await seedTestCustomer({ email: 'menus-appt@example.com' })
    const staff = await seedTestStaff()
    const menu = await (
      await req('POST', '/menus', { name: 'カット', duration_minutes: 60, price_list_amount: 7700 })
    ).json()

    const res = await req('POST', '/appointments', {
      customer_id: customer.id,
      staff_id: staff.id,
      starts_at: '2026-05-12T10:00:00Z',
      ends_at: '2026-05-12T11:00:00Z',
      menu_id: menu.id,
      booked_price_amount: 6600, // discounted below list — the AGREED price wins
      booked_price_currency: 'JPY',
    })
    expect(res.status).toBe(201)
    const appt = await res.json()
    expect(appt.menu_id).toBe(menu.id)
    expect(appt.booked_price_amount).toBe(6600)
    expect(appt.booked_price_currency).toBe('JPY')

    // The snapshot survives a menu price change — it is what was PROMISED.
    await req('PATCH', `/menus/${menu.id}`, { price_list_amount: 9900 })
    const refetched = await (await req('GET', `/appointments/${appt.id}`)).json()
    expect(refetched.booked_price_amount).toBe(6600)
  })
})
