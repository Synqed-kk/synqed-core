import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../src/types/api.js'

vi.mock('../src/services/karute.service.js', () => ({
  listKaruteRecords: vi.fn(async () => ({ karute_records: [], total: 0 })),
  getKaruteRecord: vi.fn(async () => ({ id: 'record' })),
}))
vi.mock('../src/services/supabase-auth.service.js', () => ({
  verifySupabaseAccessToken: vi.fn(async (token: string) => token),
}))
vi.mock('../src/services/permission.service.js', () => ({
  answerSheet: vi.fn(async (_business: string, user: string) => ({
    staff_id: user, visible_store_ids: null,
    capabilities: user === 'owner' ? ['recordings.viewAll'] : [],
  })),
}))

import { karuteRoutes } from '../src/routes/karute.js'
import { getKaruteRecord, listKaruteRecords } from '../src/services/karute.service.js'

const app = new Hono<AppEnv>()
app.use('*', async (c, next) => { c.set('businessId', 'business'); await next() })
app.route('/karute', karuteRoutes)
beforeEach(() => vi.clearAllMocks())

describe.each(['/karute', '/karute/record'])('hidden-read actor boundary: %s', (path) => {
  it('preserves ordinary API-key BFF reads without a bearer', async () => {
    expect((await app.request(path)).status).toBe(200)
  })
  it('requires a bearer for hidden rows before querying records', async () => {
    expect((await app.request(`${path}?include_hidden=true`)).status).toBe(401)
    expect(getKaruteRecord).not.toHaveBeenCalled()
    expect(listKaruteRecords).not.toHaveBeenCalled()
  })
  it('rejects a verified non-owner', async () => {
    expect((await app.request(`${path}?include_hidden=true`, { headers: { authorization: 'Bearer staff' } })).status).toBe(403)
    expect(getKaruteRecord).not.toHaveBeenCalled()
    expect(listKaruteRecords).not.toHaveBeenCalled()
  })
  it('allows a verified owner to request hidden rows', async () => {
    expect((await app.request(`${path}?include_hidden=true`, { headers: { authorization: 'Bearer owner' } })).status).toBe(200)
  })
})
