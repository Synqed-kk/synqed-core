import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import { createMenuSchema, listMenusSchema, updateMenuSchema } from '../validations/menu.js'
import * as menuService from '../services/menu.service.js'
import { MenuBandInvalidError } from '../services/menu.service.js'

export const menuRoutes = new Hono<AppEnv>()

menuRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const raw = Object.fromEntries(new URL(c.req.url).searchParams)
  const parsed = listMenusSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const menus = await menuService.listMenus(businessId, parsed.data)
  return c.json({ menus })
})

menuRoutes.get('/:id', async (c) => {
  const businessId = c.get('businessId')
  const menu = await menuService.getMenu(businessId, c.req.param('id'))
  if (!menu) return c.json({ error: 'Menu not found' }, 404)
  return c.json(menu)
})

menuRoutes.post('/', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = createMenuSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const menu = await menuService.createMenu(businessId, parsed.data)
  return c.json(menu, 201)
})

// PATCH (not PUT): partial update, matching the stores route convention.
// No DELETE route on purpose — menus retire via active:false, never hard
// delete (appointments snapshot-reference them).
menuRoutes.patch('/:id', async (c) => {
  const businessId = c.get('businessId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateMenuSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  try {
    const menu = await menuService.updateMenu(businessId, c.req.param('id'), parsed.data)
    return c.json(menu)
  } catch (err) {
    if (err instanceof MenuBandInvalidError) return c.json({ error: err.message }, 400)
    if (err instanceof Error && err.message === 'Menu not found') {
      return c.json({ error: 'Menu not found' }, 404)
    }
    throw err
  }
})
