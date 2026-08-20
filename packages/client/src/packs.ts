import type { SynqedClient } from './client.js'
import type {
  AuditEventInput,
  Pack,
  ActivePack,
  CreatePackInput,
  AddRedemptionInput,
  RecentRedemption,
  Lifecycle,
  SetLifecycleInput,
  AlertDismissal,
  AddAlertDismissalInput,
  AddContactInput,
  RecentContact,
  AddVisitDismissalInput,
  VisitDismissal,
} from './types.js'

/** 回数券 (ticket-pack) subsystem — business-scoped. The app keeps the usage
 *  aggregation; these serve the rows. */
export class PacksClient {
  constructor(private client: SynqedClient) {}

  // ticket_packs
  async listPacks(customerId: string): Promise<Pack[]> {
    const r = await this.client.fetch<{ packs: Pack[] }>(`/packs?customer_id=${encodeURIComponent(customerId)}`)
    return r.packs
  }
  async listActivePacks(): Promise<ActivePack[]> {
    const r = await this.client.fetch<{ packs: ActivePack[] }>('/packs/active')
    return r.packs
  }
  async createPack(input: CreatePackInput): Promise<Pack> {
    return this.client.fetch<Pack>('/packs', { method: 'POST', body: JSON.stringify(input) })
  }
  async updatePackStatus(id: string, status: string): Promise<{ ok: boolean }> {
    return this.client.fetch<{ ok: boolean }>(`/packs/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  }

  // pack_redemptions
  async listRedemptions(customerId: string): Promise<Array<{ pack_id: string; redeemed_on: string }>> {
    const r = await this.client.fetch<{ redemptions: Array<{ pack_id: string; redeemed_on: string }> }>(
      `/packs/redemptions?customer_id=${encodeURIComponent(customerId)}`,
    )
    return r.redemptions
  }
  async listAllRedemptionPackIds(): Promise<string[]> {
    const r = await this.client.fetch<{ pack_ids: string[] }>('/packs/redemptions/pack-ids')
    return r.pack_ids
  }
  async listRecentRedemptions(since: string): Promise<RecentRedemption[]> {
    const r = await this.client.fetch<{ redemptions: RecentRedemption[] }>(
      `/packs/redemptions/recent?since=${encodeURIComponent(since)}`,
    )
    return r.redemptions
  }
  /** options.audit (A1): the audit row commits in the SAME core transaction
   *  as the burn. options.idempotencyKey (scope 'pack', core #69): a retried
   *  burn replays the stored row — closes the walk-in double-burn window
   *  (NULL appointment_id rows the partial unique can't dedupe). */
  async addRedemption(
    input: AddRedemptionInput,
    options?: { audit?: AuditEventInput; idempotencyKey?: string },
  ): Promise<{ id: string }> {
    const body = options?.audit ? { ...input, audit: options.audit } : input
    return this.client.fetch<{ id: string }>('/packs/redemptions', {
      method: 'POST',
      body: JSON.stringify(body),
      ...(options?.idempotencyKey
        ? { headers: { 'Idempotency-Key': options.idempotencyKey } }
        : {}),
    })
  }
  /** Undo a 回数券 burn. removed_by records WHO undid it (soft delete —
   *  the redemption row survives with removed_at/removed_by). */
  async removeRedemption(
    id: string,
    meta?: { removed_by?: string; audit?: AuditEventInput },
  ): Promise<{ ok: boolean }> {
    const qs = meta?.removed_by ? `?removed_by=${encodeURIComponent(meta.removed_by)}` : ''
    return this.client.fetch<{ ok: boolean }>(
      `/packs/redemptions/${encodeURIComponent(id)}${qs}`,
      {
        method: 'DELETE',
        // A1 audit rides the body; proxies that strip DELETE bodies degrade
        // to the untrailed behavior server-side.
        ...(meta?.audit ? { body: JSON.stringify({ audit: meta.audit }) } : {}),
      },
    )
  }

  // customer_lifecycle
  async getLifecycle(customerId: string): Promise<Lifecycle | null> {
    try {
      return await this.client.fetch<Lifecycle>(`/packs/lifecycle/${encodeURIComponent(customerId)}`)
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) return null
      throw err
    }
  }
  async listLifecycles(): Promise<Lifecycle[]> {
    const r = await this.client.fetch<{ lifecycles: Lifecycle[] }>('/packs/lifecycles')
    return r.lifecycles
  }
  async setLifecycle(input: SetLifecycleInput): Promise<{ ok: boolean }> {
    return this.client.fetch<{ ok: boolean }>('/packs/lifecycle', { method: 'PUT', body: JSON.stringify(input) })
  }

  // pack_alert_dismissals
  async listAlertDismissals(): Promise<AlertDismissal[]> {
    const r = await this.client.fetch<{ dismissals: AlertDismissal[] }>('/packs/alert-dismissals')
    return r.dismissals
  }
  async addAlertDismissal(input: AddAlertDismissalInput): Promise<{ ok: boolean }> {
    return this.client.fetch<{ ok: boolean }>('/packs/alert-dismissals', { method: 'POST', body: JSON.stringify(input) })
  }

  // customer_contacts
  async addContact(input: AddContactInput): Promise<{ ok: boolean }> {
    return this.client.fetch<{ ok: boolean }>('/packs/contacts', { method: 'POST', body: JSON.stringify(input) })
  }
  async listRecentContacts(since: string): Promise<RecentContact[]> {
    const r = await this.client.fetch<{ contacts: RecentContact[] }>(
      `/packs/contacts/recent?since=${encodeURIComponent(since)}`,
    )
    return r.contacts
  }

  // visit_reconcile_dismissals
  async addVisitDismissal(input: AddVisitDismissalInput): Promise<{ ok: boolean }> {
    return this.client.fetch<{ ok: boolean }>('/packs/visit-dismissals', { method: 'POST', body: JSON.stringify(input) })
  }
  async listVisitDismissals(since: string): Promise<VisitDismissal[]> {
    const r = await this.client.fetch<{ dismissals: VisitDismissal[] }>(
      `/packs/visit-dismissals?since=${encodeURIComponent(since)}`,
    )
    return r.dismissals
  }
}
