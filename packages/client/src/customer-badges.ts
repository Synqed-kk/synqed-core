import type { SynqedClient } from './client.js'
import type { StaffBadgeDefinition } from './types.js'

/** Staff-only badge vocabulary, separate from member-visible ranks. */
export class CustomerBadgeClient {
  constructor(private client: SynqedClient) {}
  async get(): Promise<{ badges: StaffBadgeDefinition[] }> { return this.client.fetch('/customer-badges') }
  async set(input: { badges: StaffBadgeDefinition[]; acting_staff_id: string }): Promise<{ badges: StaffBadgeDefinition[] }> {
    return this.client.fetch('/customer-badges', { method: 'PUT', body: JSON.stringify(input) })
  }
}
