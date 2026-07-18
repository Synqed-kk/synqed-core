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
  UpsertVisitInput,
  CustomerEnrichment,
} from './types.js'

export class CustomerClient {
  constructor(private client: SynqedClient) {}

  /** Per-customer list badges (last visit, visit counts, next booking, 担当)
   *  for the whole business, aggregated server-side in one query. */
  async enrichment(): Promise<CustomerEnrichment[]> {
    const r = await this.client.fetch<{ enrichment: CustomerEnrichment[] }>('/customers/enrichment')
    return r.enrichment
  }

  async list(options?: ListCustomersOptions): Promise<ListCustomersResponse> {
    const params = new URLSearchParams()
    if (options?.search) params.set('search', options.search)
    if (options?.store_id) params.set('store_id', options.store_id)
    if (options?.include_deleted) params.set('include_deleted', 'true')
    if (options?.ids && options.ids.length > 0) {
      params.set('ids', options.ids.join(','))
    }
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

  async upsertVisits(
    id: string,
    visits: UpsertVisitInput[],
  ): Promise<{ upserted: number }> {
    return this.client.fetch<{ upserted: number }>(`/customers/${id}/visits`, {
      method: 'PUT',
      body: JSON.stringify({ visits }),
    })
  }

  /** Distinct customer counts per store (store_id), derived from events. */
  async countsByStore(): Promise<{
    counts: Record<string, number>
    unassigned: number
    total: number
  }> {
    return this.client.fetch('/customers/counts-by-store')
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
