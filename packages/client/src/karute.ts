import type { SynqedClient } from './client.js'
import type {
  KaruteRecord,
  KaruteEntry,
  KaruteEntryInput,
  UpdateKaruteEntryInput,
  EntryEditAction,
  ListEntryEditsOptions,
  ListEntryEditsResponse,
  CreateKaruteRecordInput,
  UpdateKaruteRecordInput,
  ListKaruteRecordsOptions,
  ListKaruteRecordsResponse,
} from './types.js'

export interface GetKaruteRecordOptions {
  include_entries?: boolean
  include_segments?: boolean
  include_discarded?: boolean
}

export class KaruteRecordClient {
  constructor(private client: SynqedClient) {}

  async list(options?: ListKaruteRecordsOptions): Promise<ListKaruteRecordsResponse> {
    const params = new URLSearchParams()
    if (options?.customer_id) params.set('customer_id', options.customer_id)
    if (options?.store_id) params.set('store_id', options.store_id)
    if (options?.staff_id) params.set('staff_id', options.staff_id)
    if (options?.recording_session_id)
      params.set('recording_session_id', options.recording_session_id)
    if (options?.appointment_id) params.set('appointment_id', options.appointment_id)
    if (options?.status) params.set('status', options.status)
    if (options?.include_discarded) params.set('include_discarded', 'true')
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
    if (options?.include_discarded) params.set('include_discarded', 'true')
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

  /** Returns entry_edit_id — the audit-detail handle for the change row. */
  async addEntry(karuteRecordId: string, input: KaruteEntryInput): Promise<KaruteEntry & { entry_edit_id: string }> {
    return this.client.fetch<KaruteEntry & { entry_edit_id: string }>(`/karute-records/${karuteRecordId}/entries`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /** Edit an entry in place (same id — history preserved). expected_version is
   *  required; core 409s with { current_version } when it's stale. */
  async updateEntry(
    karuteRecordId: string,
    entryId: string,
    input: UpdateKaruteEntryInput,
  ): Promise<KaruteEntry & { entry_edit_id: string }> {
    return this.client.fetch<KaruteEntry & { entry_edit_id: string }>(
      `/karute-records/${karuteRecordId}/entries/${entryId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    )
  }

  /** The 監査ログ read: append-only edit/correction rows, newest first. */
  async listEntryEdits(options?: ListEntryEditsOptions): Promise<ListEntryEditsResponse> {
    const params = new URLSearchParams()
    if (options?.karute_record_id) params.set('karute_record_id', options.karute_record_id)
    if (options?.customer_id) params.set('customer_id', options.customer_id)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch<ListEntryEditsResponse>(
      `/karute-records/entry-edits${qs ? `?${qs}` : ''}`,
    )
  }

  async deleteEntry(
    karuteRecordId: string,
    entryId: string,
    meta?: {
      actor_staff_id?: string
      action?: EntryEditAction
      /** CAS: the version the deleter loaded — stale deletes 409 with
       *  current_version instead of removing unseen content. */
      expected_version?: number
    },
  ): Promise<{ success: boolean; entry_edit_id: string }> {
    const params = new URLSearchParams()
    if (meta?.actor_staff_id) params.set('actor_staff_id', meta.actor_staff_id)
    if (meta?.action) params.set('action', meta.action)
    if (meta?.expected_version !== undefined)
      params.set('expected_version', String(meta.expected_version))
    const qs = params.toString()
    return this.client.fetch<{ success: boolean; entry_edit_id: string }>(
      `/karute-records/${karuteRecordId}/entries/${entryId}${qs ? `?${qs}` : ''}`,
      { method: 'DELETE' },
    )
  }
}
