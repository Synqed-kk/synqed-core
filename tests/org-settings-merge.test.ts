import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { cleanupTestData, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

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
  await testPrisma.orgSettings.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('org settings — atomic shallow merge', () => {
  it('two admins writing different keys concurrently both survive (the lost-update Liam flagged)', async () => {
    await req('PUT', '/org-settings', { settings: { base: true } })
    // Concurrent single-key writes — old read-then-replace dropped one.
    const [a, b] = await Promise.all([
      req('PUT', '/org-settings', { settings: { toggle_a: 1 } }),
      req('PUT', '/org-settings', { settings: { toggle_b: 2 } }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const final = await (await req('GET', '/org-settings')).json()
    expect(final.settings.base).toBe(true)
    expect(final.settings.toggle_a).toBe(1)
    expect(final.settings.toggle_b).toBe(2)
  })

  it('merge updates only the sent key; null clears a key value; name-only update leaves settings intact', async () => {
    await req('PUT', '/org-settings', { settings: { keep: 'x', change: 'old' } })
    await req('PUT', '/org-settings', { settings: { change: 'new' } })
    let s = await (await req('GET', '/org-settings')).json()
    expect(s.settings).toEqual({ keep: 'x', change: 'new' })

    await req('PUT', '/org-settings', { settings: { change: null } })
    s = await (await req('GET', '/org-settings')).json()
    expect(s.settings.change).toBeNull()
    expect(s.settings.keep).toBe('x')

    await req('PUT', '/org-settings', { name: '店名' })
    s = await (await req('GET', '/org-settings')).json()
    expect(s.name).toBe('店名')
    expect(s.settings.keep).toBe('x')
  })
})
