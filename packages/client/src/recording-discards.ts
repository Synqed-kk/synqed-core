import type { SynqedClient } from './client.js'
import type { RecordingDiscardEvent, RecordDiscardInput, ListRecordingDiscardsOptions } from './types.js'

/** One row per recording discard. Staff discards REQUIRE a written reason
 *  (the reason is content — put the returned row id in audit detail, never
 *  the text); system cleanup rows carry none. */
export class RecordingDiscardClient {
  constructor(private client: SynqedClient) {}

  async create(input: RecordDiscardInput): Promise<RecordingDiscardEvent> {
    return this.client.fetch<RecordingDiscardEvent>('/recording-discards', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /** Immutable manager acknowledgement; actor and timestamp come from bearer auth. */
  async confirm(id: string): Promise<RecordingDiscardEvent> {
    return this.client.fetch<RecordingDiscardEvent>(
      `/recording-discards/${encodeURIComponent(id)}/confirmation`,
      { method: 'PUT', body: '{}' },
    )
  }

  async list(options?: ListRecordingDiscardsOptions): Promise<{
    events: RecordingDiscardEvent[]
    total: number
    page: number
    page_size: number
  }> {
    const params = new URLSearchParams()
    if (options?.recording_session_id) params.set('recording_session_id', options.recording_session_id)
    if (options?.recording_session_ids !== undefined) params.set('recording_session_ids', options.recording_session_ids.join(','))
    if (options?.created_from) params.set('created_from', options.created_from)
    if (options?.created_before) params.set('created_before', options.created_before)
    if (options?.source) params.set('source', options.source)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch(`/recording-discards${qs ? `?${qs}` : ''}`)
  }
}
