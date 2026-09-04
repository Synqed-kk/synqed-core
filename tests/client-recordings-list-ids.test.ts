import { afterEach, describe, expect, it, vi } from 'vitest'
import { SynqedClient } from '../packages/client/src/index.js'

const firstId = '10000000-0000-0000-0000-000000000001'
const secondId = '20000000-0000-0000-0000-000000000002'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SDK recordings.list ids filter', () => {
  it('serializes non-empty ids and omits an empty list like customers.list', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        urls.push(String(url))
        return new Response(
          JSON.stringify({ recordings: [], total: 0, page: 1, page_size: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const client = new SynqedClient({
      baseUrl: 'http://core.test',
      apiKey: 'test-key',
      businessId: 'test-business',
    })

    await client.recordings.list({ ids: [firstId, secondId], page: 2, page_size: 1 })
    await client.recordings.list({ ids: [], page_size: 1 })

    expect(urls).toEqual([
      `http://core.test/v1/recordings?ids=${firstId}%2C${secondId}&page=2&page_size=1`,
      'http://core.test/v1/recordings?page_size=1',
    ])
  })
})
