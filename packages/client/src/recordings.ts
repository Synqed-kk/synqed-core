import type { SynqedClient } from './client.js'
import type {
  Recording,
  CreateRecordingInput,
  UpdateRecordingInput,
  ListRecordingsOptions,
  ListRecordingsResponse,
  TranscriptionSegment,
  SegmentInput,
} from './types.js'

export class RecordingClient {
  constructor(private client: SynqedClient) {}

  async list(options?: ListRecordingsOptions): Promise<ListRecordingsResponse> {
    const params = new URLSearchParams()
    if (options?.from) params.set('from', options.from)
    if (options?.to) params.set('to', options.to)
    if (options?.date) params.set('date', options.date)
    if (options?.customer_id) params.set('customer_id', options.customer_id)
    if (options?.staff_id) params.set('staff_id', options.staff_id)
    if (options?.status) params.set('status', options.status)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch<ListRecordingsResponse>(`/recordings${qs ? `?${qs}` : ''}`)
  }

  async get(id: string): Promise<Recording> {
    return this.client.fetch<Recording>(`/recordings/${id}`)
  }

  async create(input: CreateRecordingInput): Promise<Recording> {
    return this.client.fetch<Recording>('/recordings', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateRecordingInput): Promise<Recording> {
    return this.client.fetch<Recording>(`/recordings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  async delete(id: string): Promise<void> {
    await this.client.fetch(`/recordings/${id}`, { method: 'DELETE' })
  }

  async listSegments(recordingId: string): Promise<{ segments: TranscriptionSegment[] }> {
    return this.client.fetch<{ segments: TranscriptionSegment[] }>(
      `/recordings/${recordingId}/segments`,
    )
  }

  async upsertSegments(
    recordingId: string,
    segments: SegmentInput[],
    options?: { replace?: boolean },
  ): Promise<{ segments: TranscriptionSegment[] }> {
    return this.client.fetch<{ segments: TranscriptionSegment[] }>(
      `/recordings/${recordingId}/segments`,
      {
        method: 'POST',
        body: JSON.stringify({ segments, replace: options?.replace ?? false }),
      },
    )
  }
}
