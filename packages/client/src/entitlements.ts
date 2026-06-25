import type { SynqedClient } from './client.js'
import type { Entitlement, UpsertEntitlementInput } from './types.js'

export class EntitlementClient {
  constructor(private client: SynqedClient) {}

  async get(): Promise<Entitlement> {
    return this.client.fetch<Entitlement>('/entitlements')
  }

  async upsert(input: UpsertEntitlementInput): Promise<Entitlement> {
    return this.client.fetch<Entitlement>('/entitlements', {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }
}
