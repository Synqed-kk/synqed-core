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
}
