import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../src/types/api.js'

vi.mock('../src/services/recording-discard.service.js', () => ({
  listDiscardEvents: vi.fn(async () => ({ events: [], total: 0, page: 1, page_size: 100 })),
  InvalidDiscardError: class extends Error {},
  DiscardConfirmationForbiddenError: class extends Error {},
}))
vi.mock('../src/services/supabase-auth.service.js', () => ({ verifySupabaseAccessToken: vi.fn() }))
vi.mock('../src/services/permission.service.js', () => ({ answerSheet: vi.fn() }))

import { recordingDiscardRoutes } from '../src/routes/recording-discards.js'
import { listDiscardEvents } from '../src/services/recording-discard.service.js'

const id1 = '10000000-0000-0000-0000-000000000001'
const id2 = '20000000-0000-0000-0000-000000000002'
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => { c.set('businessId', 'business'); await next() })
app.route('/discards', recordingDiscardRoutes)
beforeEach(() => vi.clearAllMocks())

describe('recording discard list contract', () => {
  it('parses session-set, source, range, and pagination together', async () => {
    const query = new URLSearchParams({
      recording_session_ids: `${id1},${id2}`,
      source: 'STAFF', from: '2026-09-01T00:00:00Z', to: '2026-09-11T00:00:00Z',
      page: '2', page_size: '50',
    })
    expect((await app.request(`/discards?${query}`)).status).toBe(200)
    expect(listDiscardEvents).toHaveBeenCalledWith('business', expect.objectContaining({
      recording_session_ids: [id1, id2], source: 'STAFF', page: 2, page_size: 50,
    }))
  })

  it.each([
    `recording_session_ids=${id1},bad`,
    'from=bad',
    'page_size=501',
    'from=2026-09-11T00%3A00%3A00Z&to=2026-09-10T00%3A00%3A00Z',
  ])('rejects invalid filters before querying: %s', async (query) => {
    expect((await app.request(`/discards?${query}`)).status).toBe(400)
    expect(listDiscardEvents).not.toHaveBeenCalled()
  })

  it('defines an empty session set as the ordinary unfiltered list', async () => {
    expect((await app.request('/discards?recording_session_ids=')).status).toBe(200)
    expect(listDiscardEvents).toHaveBeenCalledWith('business', expect.objectContaining({ recording_session_ids: undefined }))
  })
})
