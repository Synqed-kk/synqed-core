import type { SynqedClient } from './client.js'
import type { StoreBookingPolicy, SetStoreBookingPolicyInput } from './types.js'

/** Per-store booking-acceptance policy: horizon, cutoff, cancellation terms.
 *  Absent row = platform defaults (source: 'default'). */
export class StorePolicyClient {
  constructor(private client: SynqedClient) {}

  async list(): Promise<{ policies: StoreBookingPolicy[] }> {
    return this.client.fetch<{ policies: StoreBookingPolicy[] }>('/store-policies')
  }

  /** The BFF calendar read: one store's effective policy. */
  async get(storeId: string): Promise<StoreBookingPolicy> {
    return this.client.fetch<StoreBookingPolicy>(`/store-policies/${encodeURIComponent(storeId)}`)
  }

  /** HQ-gated partial upsert; optional audit commits with the change. */
  async set(storeId: string, input: SetStoreBookingPolicyInput): Promise<StoreBookingPolicy> {
    return this.client.fetch<StoreBookingPolicy>(`/store-policies/${encodeURIComponent(storeId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }
}
