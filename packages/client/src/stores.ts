import type { SynqedClient } from './client.js'
import type {
  Store,
  CreateStoreInput,
  UpdateStoreInput,
  ListStoresResponse,
} from './types.js'

export class StoreClient {
  constructor(private client: SynqedClient) {}

  async list(): Promise<ListStoresResponse> {
    return this.client.fetch<ListStoresResponse>('/stores')
  }

  async get(id: string): Promise<Store> {
    return this.client.fetch<Store>(`/stores/${id}`)
  }

  async create(input: CreateStoreInput): Promise<Store> {
    return this.client.fetch<Store>('/stores', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateStoreInput): Promise<Store> {
    return this.client.fetch<Store>(`/stores/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }
}
