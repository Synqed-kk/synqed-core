import type { SynqedClient } from './client.js'
import type {
  Menu,
  CreateMenuInput,
  UpdateMenuInput,
  ListMenusOptions,
  ListMenusResponse,
} from './types.js'

export class MenuClient {
  constructor(private client: SynqedClient) {}

  async list(options?: ListMenusOptions): Promise<ListMenusResponse> {
    const params = new URLSearchParams()
    if (options?.store_id) params.set('store_id', options.store_id)
    if (options?.active !== undefined) params.set('active', String(options.active))
    if (options?.online_visible !== undefined) params.set('online_visible', String(options.online_visible))
    const qs = params.toString()
    return this.client.fetch<ListMenusResponse>(`/menus${qs ? `?${qs}` : ''}`)
  }

  async get(id: string): Promise<Menu> {
    return this.client.fetch<Menu>(`/menus/${id}`)
  }

  async create(input: CreateMenuInput): Promise<Menu> {
    return this.client.fetch<Menu>('/menus', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateMenuInput): Promise<Menu> {
    return this.client.fetch<Menu>(`/menus/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }
}
