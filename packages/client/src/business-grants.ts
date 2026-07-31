import type { SynqedClient } from './client.js'
import type { BusinessGrant } from './types.js'

/** Org-level capabilities (HQ_ADMIN first) — separate from store staff roles. */
export class BusinessGrantClient {
  constructor(private client: SynqedClient) {}

  async list(): Promise<{ grants: BusinessGrant[] }> {
    return this.client.fetch<{ grants: BusinessGrant[] }>('/business-grants')
  }

  /** Capability probe: accepts staff card id OR login uuid. */
  async check(staffId: string, grant: 'HQ_ADMIN' = 'HQ_ADMIN'): Promise<{ granted: boolean }> {
    const qs = new URLSearchParams({ staff_id: staffId, grant })
    return this.client.fetch<{ granted: boolean }>(`/business-grants/check?${qs}`)
  }

  /** OWNER or existing HQ_ADMIN only. */
  async add(input: {
    staff_id: string
    grant: 'HQ_ADMIN'
    acting_staff_id: string
  }): Promise<BusinessGrant> {
    return this.client.fetch<BusinessGrant>('/business-grants', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async revoke(grantId: string, actingStaffId: string): Promise<{ ok: boolean }> {
    return this.client.fetch<{ ok: boolean }>(
      `/business-grants/${encodeURIComponent(grantId)}?acting_staff_id=${encodeURIComponent(actingStaffId)}`,
      { method: 'DELETE' },
    )
  }
}
