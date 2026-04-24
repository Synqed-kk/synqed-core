import type { SynqedClient } from './client.js'
import type {
  KaruteRecord,
  KaruteEntry,
  KaruteEntryInput,
  CreateKaruteRecordInput,
  UpdateKaruteRecordInput,
  ListKaruteRecordsOptions,
  ListKaruteRecordsResponse,
} from './types.js'

export interface GetKaruteRecordOptions {
  include_entries?: boolean
  include_segments?: boolean
}

export class KaruteRecordClient {
  constructor(private client: SynqedClient) {}

  async list(options?: ListKaruteRecordsOptions): Promise<ListKaruteRecordsResponse> {
    const params = new URLSearchParams()
    if (options?.customer_id) params.set('customer_id', options.customer_id)
    if (options?.staff_id) params.set('staff_id', options.staff_id)
    if (options?.recording_session_id)
      params.set('recording_session_id', options.recording_session_id)
    if (options?.status) params.set('status', options.status)
    if (options?.from) params.set('from', options.from)
    if (options?.to) params.set('to', options.to)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch<ListKaruteRecordsResponse>(`/karute-records${qs ? `?${qs}` : ''}`)
  }

  async get(id: string, options?: GetKaruteRecordOptions): Promise<KaruteRecord> {
    const params = new URLSearchParams()
    if (options?.include_entries === false) params.set('include_entries', 'false')
    if (options?.include_segments) params.set('include_segments', 'true')
    const qs = params.toString()
    return this.client.fetch<KaruteRecord>(`/karute-records/${id}${qs ? `?${qs}` : ''}`)
  }

  async getByRecordingSession(
    recordingSessionId: string,
    options?: GetKaruteRecordOptions,
  ): Promise<KaruteRecord> {
    const params = new URLSearchParams()
    if (options?.include_entries === false) params.set('include_entries', 'false')
    if (options?.include_segments) params.set('include_segments', 'true')
    const qs = params.toString()
    return this.client.fetch<KaruteRecord>(
      `/karute-records/by-recording/${recordingSessionId}${qs ? `?${qs}` : ''}`,
    )
  }

  async create(input: CreateKaruteRecordInput): Promise<KaruteRecord> {
    return this.client.fetch<KaruteRecord>('/karute-records', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateKaruteRecordInput): Promise<KaruteRecord> {
    return this.client.fetch<KaruteRecord>(`/karute-records/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  async delete(id: string): Promise<void> {
    await this.client.fetch(`/karute-records/${id}`, { method: 'DELETE' })
  }

  async addEntry(karuteRecordId: string, input: KaruteEntryInput): Promise<KaruteEntry> {
    return this.client.fetch<KaruteEntry>(`/karute-records/${karuteRecordId}/entries`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async deleteEntry(karuteRecordId: string, entryId: string): Promise<void> {
    await this.client.fetch(`/karute-records/${karuteRecordId}/entries/${entryId}`, {
      method: 'DELETE',
    })
  }
}
