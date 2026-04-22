import type { SynqedClient } from './client.js'
import type {
  Staff,
  CreateStaffInput,
  UpdateStaffInput,
  ListStaffOptions,
  ListStaffResponse,
} from './types.js'

export class StaffClient {
  constructor(private client: SynqedClient) {}

  async list(options?: ListStaffOptions): Promise<ListStaffResponse> {
    const params = new URLSearchParams()
    if (options?.search) params.set('search', options.search)
    if (options?.is_active !== undefined) params.set('is_active', String(options.is_active))
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch<ListStaffResponse>(`/staff${qs ? `?${qs}` : ''}`)
  }

  async get(id: string): Promise<Staff> {
    return this.client.fetch<Staff>(`/staff/${id}`)
  }

  async create(input: CreateStaffInput): Promise<Staff> {
    return this.client.fetch<Staff>('/staff', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateStaffInput): Promise<Staff> {
    return this.client.fetch<Staff>(`/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  async delete(id: string): Promise<void> {
    await this.client.fetch(`/staff/${id}`, { method: 'DELETE' })
  }
}
