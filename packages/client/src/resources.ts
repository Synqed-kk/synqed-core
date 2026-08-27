import type { SynqedClient } from './client.js'
import type { SalonResource, CreateResourceInput, UpdateResourceInput } from './types.js'

/** The bed plane: rooms/beds/booths per store. Never hard-deleted — retire
 *  via active:false. Claim one on a booking via appointment.resource_id; a
 *  taken bed 409s with code RESOURCE_TAKEN (distinct from the staff 409). */
export class ResourceClient {
  constructor(private client: SynqedClient) {}

  async list(options?: { store_id?: string; active?: boolean }): Promise<{ resources: SalonResource[] }> {
    const params = new URLSearchParams()
    if (options?.store_id) params.set('store_id', options.store_id)
    if (options?.active !== undefined) params.set('active', String(options.active))
    const qs = params.toString()
    return this.client.fetch(`/resources${qs ? `?${qs}` : ''}`)
  }

  async create(input: CreateResourceInput): Promise<SalonResource> {
    return this.client.fetch<SalonResource>('/resources', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateResourceInput): Promise<SalonResource> {
    return this.client.fetch<SalonResource>(`/resources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }
}
