import type { SynqedClient } from './client.js'
import type { Invite, CreateInviteInput, ListInvitesOptions, ListInvitesResponse } from './types.js'

export class InviteClient {
  constructor(private client: SynqedClient) {}

  async list(options?: ListInvitesOptions): Promise<ListInvitesResponse> {
    const params = new URLSearchParams()
    if (options?.page !== undefined) params.set('page', String(options.page))
    if (options?.page_size !== undefined) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch<ListInvitesResponse>(`/invites${qs ? `?${qs}` : ''}`)
  }

  /** One invite by id, scoped to the client's business. Throws SynqedError(404)
   *  if it does not exist or belongs to another business. */
  async get(id: string): Promise<Invite> {
    return this.client.fetch<Invite>(`/invites/${encodeURIComponent(id)}`)
  }

  /** Public (pre-auth) lookup by token — no business scope needed; the token is
   *  the secret. Throws SynqedError(404) if the token isn't found. */
  async getByToken(token: string): Promise<Invite> {
    return this.client.fetch<Invite>(`/invites/by-token/${encodeURIComponent(token)}`)
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
