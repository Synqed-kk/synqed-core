import type { SynqedClient } from './client.js'

/** Global AI-response cache (API-key-gated, business-optional). Best-effort:
 *  get returns null on a miss/expiry. */
export class AiCacheClient {
  constructor(private client: SynqedClient) {}

  async get(key: string): Promise<unknown | null> {
    try {
      const r = await this.client.fetch<{ result: unknown }>(`/ai-cache/${encodeURIComponent(key)}`)
      return r.result
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
        return null
      }
      throw err
    }
  }

  async upsert(input: { cache_key: string; result: unknown; expires_at: string }): Promise<{ ok: true }> {
    return this.client.fetch<{ ok: true }>('/ai-cache', { method: 'PUT', body: JSON.stringify(input) })
  }

  /** Cross-business maintenance — delete expired entries. */
  async cleanup(): Promise<{ deleted: number }> {
    return this.client.fetch<{ deleted: number }>('/ai-cache/cleanup', { method: 'POST' })
  }
}
