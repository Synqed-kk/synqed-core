import type { SynqedClient } from './client.js'
import type { Invite, CreateInviteInput, ListInvitesResponse } from './types.js'

export class InviteClient {
  constructor(private client: SynqedClient) {}

  async list(): Promise<ListInvitesResponse> {
    return this.client.fetch<ListInvitesResponse>('/invites')
  }

  async create(input: CreateInviteInput): Promise<Invite> {
    return this.client.fetch<Invite>('/invites', { method: 'POST', body: JSON.stringify(input) })
  }

  async updateStatus(id: string, status: string): Promise<Invite> {
    return this.client.fetch<Invite>(`/invites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  }
}
