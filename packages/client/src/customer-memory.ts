import type { SynqedClient } from './client.js'
import type {
  MemoryItem,
  CreateMemoryItemInput,
  UpdateMemoryItemInput,
  ListMemoryItemsResponse,
} from './types.js'

export class CustomerMemoryClient {
  constructor(private client: SynqedClient) {}

  async list(customerId: string): Promise<ListMemoryItemsResponse> {
    return this.client.fetch<ListMemoryItemsResponse>(
      `/customer-memory?customer_id=${encodeURIComponent(customerId)}`,
    )
  }

  async create(input: CreateMemoryItemInput): Promise<MemoryItem> {
    return this.client.fetch<MemoryItem>('/customer-memory', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateMemoryItemInput): Promise<MemoryItem> {
    return this.client.fetch<MemoryItem>(`/customer-memory/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  async delete(id: string): Promise<{ ok: true }> {
    return this.client.fetch<{ ok: true }>(`/customer-memory/${id}`, { method: 'DELETE' })
  }
}
