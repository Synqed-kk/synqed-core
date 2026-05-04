import type { SynqedClient } from './client.js'
import type { AiRateLimitResult } from './types.js'

export class AiRateLimitClient {
  constructor(private client: SynqedClient) {}

  async consume(route: string): Promise<AiRateLimitResult> {
    return this.client.fetch<AiRateLimitResult>('/ai-rate-limit/consume', {
      method: 'POST',
      body: JSON.stringify({ route }),
    })
  }

  async recordUsage(
    route: string,
    tokensIn: number | null,
    tokensOut: number | null,
    costCents: number | null,
  ): Promise<void> {
    await this.client.fetch<{ ok: true }>('/ai-rate-limit/record-usage', {
      method: 'POST',
      body: JSON.stringify({
        route,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_cents: costCents,
      }),
    })
  }
}
