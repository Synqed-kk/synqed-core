// Vercel Cron invokes its `path` with GET — the POST-only route 404'd every
// 15-minute tick and the QuickReserve auto-crawl silently never ran. Pins:
// GET works (the cron path), POST still works (manual dispatch), auth stays.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index.js'

vi.mock('../src/services/sync.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sync.service.js')>()
  return { ...actual, dispatchCron: vi.fn(async () => ({ dispatched: 0, results: [] })) }
})

const SECRET = 'test-cron-secret'

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
})

describe('sync cron dispatch', () => {
  it('GET with the cron secret dispatches (the Vercel Cron path)', async () => {
    const res = await app.request('/v1/sync/cron/dispatch', {
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}` },
    })
    expect(res.status).toBe(200)
  })

  it('POST with the cron secret still dispatches (manual path)', async () => {
    const res = await app.request('/v1/sync/cron/dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
    })
    expect(res.status).toBe(200)
  })

  it('rejects a missing/wrong secret with 401', async () => {
    const bad = await app.request('/v1/sync/cron/dispatch', {
      method: 'GET',
      headers: { authorization: 'Bearer wrong' },
    })
    expect(bad.status).toBe(401)
    const none = await app.request('/v1/sync/cron/dispatch', { method: 'GET' })
    expect(none.status).toBe(401)
  })
})
