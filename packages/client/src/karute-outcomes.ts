import type { SynqedClient } from './client.js'
import type { KaruteOutcome, UpsertKaruteOutcomeInput } from './types.js'

export class KaruteOutcomeClient {
  constructor(private client: SynqedClient) {}

  /** Read a session's outcome by karute record id, or null if none recorded. */
  async get(karuteRecordId: string): Promise<KaruteOutcome | null> {
    try {
      return await this.client.fetch<KaruteOutcome>(
        `/karute-outcomes/${encodeURIComponent(karuteRecordId)}`,
      )
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
        return null
      }
      throw err
    }
  }

  /** Upsert a session's outcome (keyed on karute_record_id). */
  async upsert(input: UpsertKaruteOutcomeInput): Promise<KaruteOutcome> {
    return this.client.fetch<KaruteOutcome>('/karute-outcomes', {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }
}
