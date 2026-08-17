import type { SynqedClient } from './client.js'
import type { KaruteOutcome, UpsertKaruteOutcomeInput, ListKaruteOutcomesOptions, ListKaruteOutcomesResponse } from './types.js'

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

  /** Business-scoped list — built for the pending-auto-close cron:
   *  list({ outcome: 'pending', decision_context: 'conversion',
   *  updated_before: <now-14d ISO> }). */
  async list(options?: ListKaruteOutcomesOptions): Promise<ListKaruteOutcomesResponse> {
    const params = new URLSearchParams()
    if (options?.outcome) params.set('outcome', options.outcome)
    if (options?.decision_context) params.set('decision_context', options.decision_context)
    if (options?.updated_before) params.set('updated_before', options.updated_before)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch<ListKaruteOutcomesResponse>(`/karute-outcomes${qs ? `?${qs}` : ''}`)
  }

  /** Upsert a session's outcome (keyed on karute_record_id). */
  async upsert(input: UpsertKaruteOutcomeInput): Promise<KaruteOutcome> {
    return this.client.fetch<KaruteOutcome>('/karute-outcomes', {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }
}
