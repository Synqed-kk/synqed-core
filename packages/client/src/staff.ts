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

  // `actingStaffId` is the signed-in staff performing the change. The server
  // gates it: you may set your own PIN, or an OWNER/ADMIN may set anyone's.
  async setPin(id: string, pin: string, actingStaffId: string): Promise<void> {
    await this.client.fetch(`/staff/${id}/pin`, {
      method: 'PUT',
      body: JSON.stringify({ pin, acting_staff_id: actingStaffId }),
    })
  }

  // Query param, not a body: DELETE bodies get stripped by some proxies.
  async removePin(id: string, actingStaffId: string): Promise<void> {
    const qs = new URLSearchParams({ acting_staff_id: actingStaffId }).toString()
    await this.client.fetch(`/staff/${id}/pin?${qs}`, { method: 'DELETE' })
  }

  async verifyPin(id: string, pin: string): Promise<{ valid: boolean; no_pin?: boolean }> {
    return this.client.fetch<{ valid: boolean; no_pin?: boolean }>(
      `/staff/${id}/pin/verify`,
      { method: 'POST', body: JSON.stringify({ pin }) },
    )
  }

  async hasPin(id: string): Promise<{ has_pin: boolean }> {
    return this.client.fetch<{ has_pin: boolean }>(`/staff/${id}/pin`)
  }

  async uploadAvatar(id: string, file: File): Promise<{ avatar_url: string }> {
    const formData = new FormData()
    formData.append('file', file)
    return this.client.fetchMultipart<{ avatar_url: string }>(
      `/staff/${id}/avatar`,
      formData,
    )
  }
}
