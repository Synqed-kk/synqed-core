import type { SynqedClient } from './client.js'
import type { StaffStoresResponse, StaffStoreCountsResponse } from './types.js'

export class StaffStoreClient {
  constructor(private client: SynqedClient) {}

  /** Per-store staff counts for the business. */
  async counts(): Promise<StaffStoreCountsResponse> {
    return this.client.fetch<StaffStoreCountsResponse>('/staff-stores/counts')
  }

  /** The store ids a staff member is assigned to (empty = every store). */
  async get(staffId: string): Promise<StaffStoresResponse> {
    return this.client.fetch<StaffStoresResponse>(`/staff-stores/${staffId}`)
  }

  /** Replace a staff member's full store set. */
  async set(staffId: string, storeIds: string[]): Promise<{ ok: true }> {
    return this.client.fetch<{ ok: true }>(`/staff-stores/${staffId}`, {
      method: 'PUT',
      body: JSON.stringify({ store_ids: storeIds }),
    })
  }
}
