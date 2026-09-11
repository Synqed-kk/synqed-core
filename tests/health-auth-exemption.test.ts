import { describe, it, expect } from 'vitest'
import app from '../src/index.js'
import { TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY

/** Readiness must be reachable without a key so an uptime monitor can page on
 *  the 503. Widening the auth exemption to reach it is where this gets
 *  dangerous: an unanchored `/\/health(\/|$)/` also matched any path with a
 *  `health` SEGMENT, so `/v1/ai-cache/health` skipped the API-key check and
 *  handed a global cache entry to an anonymous caller.
 *
 *  These cases pin both halves: the two real health routes are open, and
 *  nothing else is. */
describe('health auth exemption', () => {
  it.each([
    ['/v1/health'],
    ['/v1/health/ready'],
  ])('%s is reachable without an API key', async (path) => {
    const res = await app.request(path)
    expect(res.status).not.toBe(401)
  })

  it.each([
    // The exact bypass Greptile found: /:key on the global AI cache.
    ['/v1/ai-cache/health'],
    ['/v1/ai-cache/health/ready'],
    // Any other route whose parameter could spell `health`.
    ['/v1/customers/health'],
    ['/v1/stores/health'],
    ['/v1/menus/health'],
  ])('%s still requires an API key', async (path) => {
    const res = await app.request(path)
    expect(res.status).toBe(401)
  })

  it('a path merely CONTAINING health is not exempt', async () => {
    const res = await app.request('/v1/recordings/health/anything')
    expect(res.status).toBe(401)
  })

  it('the exemption does not leak to a lookalike prefix', async () => {
    const res = await app.request('/v1/healthz')
    expect(res.status).toBe(401)
  })
})
