import type { SynqedClient } from './client.js'
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersOptions,
  ListCustomersResponse,
  CheckDuplicateResponse,
  CustomerPhoto,
  RecordingConsent,
  GrantRecordingConsentInput,
} from './types.js'

export class CustomerClient {
  constructor(private client: SynqedClient) {}

  async list(options?: ListCustomersOptions): Promise<ListCustomersResponse> {
    const params = new URLSearchParams()
    if (options?.search) params.set('search', options.search)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    if (options?.sort_by) params.set('sort_by', options.sort_by)
    if (options?.sort_order) params.set('sort_order', options.sort_order)

    const qs = params.toString()
    return this.client.fetch<ListCustomersResponse>(
      `/customers${qs ? `?${qs}` : ''}`
    )
  }

  async get(id: string): Promise<Customer> {
    return this.client.fetch<Customer>(`/customers/${id}`)
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    return this.client.fetch<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.client.fetch<Customer>(`/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  async delete(id: string): Promise<void> {
    await this.client.fetch(`/customers/${id}`, { method: 'DELETE' })
  }

  async checkDuplicate(name: string): Promise<CheckDuplicateResponse> {
    return this.client.fetch<CheckDuplicateResponse>(
      `/customers/check-duplicate?name=${encodeURIComponent(name)}`
    )
  }

  async listPhotos(id: string): Promise<{ photos: CustomerPhoto[] }> {
    return this.client.fetch<{ photos: CustomerPhoto[] }>(
      `/customers/${id}/photos`,
    )
  }

  async uploadPhoto(
    id: string,
    file: File,
    options: { category?: string; caption?: string } = {},
  ): Promise<CustomerPhoto> {
    const formData = new FormData()
    formData.append('file', file)
    if (options.category) formData.append('category', options.category)
    if (options.caption) formData.append('caption', options.caption)
    return this.client.fetchMultipart<CustomerPhoto>(
      `/customers/${id}/photos`,
      formData,
    )
  }

  async deletePhoto(id: string, photoId: string): Promise<void> {
    await this.client.fetch(`/customers/${id}/photos/${photoId}`, {
      method: 'DELETE',
    })
  }

  async getConsent(id: string): Promise<{ consent: RecordingConsent | null }> {
    return this.client.fetch<{ consent: RecordingConsent | null }>(
      `/customers/${id}/consent`,
    )
  }

  async grantConsent(
    id: string,
    input: GrantRecordingConsentInput,
  ): Promise<RecordingConsent> {
    return this.client.fetch<RecordingConsent>(`/customers/${id}/consent`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async revokeConsent(id: string, revokedByStaffId: string): Promise<void> {
    await this.client.fetch(`/customers/${id}/consent`, {
      method: 'DELETE',
      body: JSON.stringify({ revoked_by_staff_id: revokedByStaffId }),
    })
  }
}
