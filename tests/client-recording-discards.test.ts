import { afterEach, describe, expect, it, vi } from 'vitest'
import { SynqedClient } from '../packages/client/src/index.js'

const karuteRecordId = '10000000-0000-0000-0000-000000000001'
const recordingSessionId = '20000000-0000-0000-0000-000000000002'
const staffId = '30000000-0000-0000-0000-000000000003'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SDK actor authentication', () => {
  it('forwards the request-scoped bearer token to discard confirmation', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          id: '40000000-0000-0000-0000-000000000004',
          recording_session_id: recordingSessionId,
          karute_record_id: null,
          source: 'STAFF',
          discarded_by: staffId,
          reason: 'written reason',
          confirmed_by: staffId,
          confirmed_at: '2026-09-03T00:00:00.000Z',
          created_at: '2026-09-02T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new SynqedClient({
      baseUrl: 'http://core.test',
      apiKey: 'test-key',
      businessId: 'test-business',
      accessToken: 'verified-user-token',
    })
    await client.recordingDiscards.confirm('40000000-0000-0000-0000-000000000004')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'http://core.test/v1/recording-discards/40000000-0000-0000-0000-000000000004/confirmation',
    )
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer verified-user-token' })
  })
})

describe('SDK recordingDiscards.create', () => {
  it('sends either a karute record key or the existing recording session key', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({
            id: '40000000-0000-0000-0000-000000000004',
            recording_session_id: null,
            karute_record_id: karuteRecordId,
            source: 'STAFF',
            discarded_by: staffId,
            reason: 'written reason',
            created_at: '2026-09-02T00:00:00.000Z',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const client = new SynqedClient({
      baseUrl: 'http://core.test',
      apiKey: 'test-key',
      businessId: 'test-business',
    })

    await client.recordingDiscards.create({
      karute_record_id: karuteRecordId,
      source: 'STAFF',
      discarded_by: staffId,
      reason: 'written reason',
    })
    await client.recordingDiscards.create({
      recording_session_id: recordingSessionId,
      source: 'SYSTEM',
    })

    expect(requests).toEqual([
      {
        url: 'http://core.test/v1/recording-discards',
        body: {
          karute_record_id: karuteRecordId,
          source: 'STAFF',
          discarded_by: staffId,
          reason: 'written reason',
        },
      },
      {
        url: 'http://core.test/v1/recording-discards',
        body: { recording_session_id: recordingSessionId, source: 'SYSTEM' },
      },
    ])
  })
})
