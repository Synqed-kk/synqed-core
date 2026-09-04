// SDK regression: karuteRecords.list typed `store_id` (ListKaruteRecordsOptions)
// but never serialized it into the query string, so the karute app's store
// scoping silently no-op'd and every store's karute showed everywhere.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SynqedClient } from '../packages/client/src/index.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SDK karuteRecords.list', () => {
  it('serializes store_id into the query string', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        urls.push(String(url))
        return new Response(
          JSON.stringify({ karute_records: [], total: 0, page: 1, page_size: 200 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const client = new SynqedClient({
      baseUrl: 'http://core.test',
      apiKey: 'test-key',
      businessId: 'test-business',
    })
    await client.karuteRecords.list({ store_id: 'store-1', page_size: 200 })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('store_id=store-1')
  })

  it('serializes include_discarded for list and get', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        urls.push(String(url))
        return new Response(
          JSON.stringify({ karute_records: [], total: 0, discarded_count: 0, page: 1, page_size: 100 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const client = new SynqedClient({
      baseUrl: 'http://core.test',
      apiKey: 'test-key',
      businessId: 'test-business',
    })
    await client.karuteRecords.list({ include_discarded: true })
    await client.karuteRecords.get('record-1', { include_discarded: true })

    expect(urls[0]).toContain('include_discarded=true')
    expect(urls[1]).toContain('include_discarded=true')
  })
})
