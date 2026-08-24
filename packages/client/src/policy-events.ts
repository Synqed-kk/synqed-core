import type { SynqedClient } from './client.js'
import type { StaffPolicyEvent } from './types.js'

/** Per-staff recording-policy ledger — the queryable read side of policy
 *  acknowledgement (the audit log stays the append-only proof). Three events;
 *  'delivered' is the system's, not the staff member's. No 'declined' exists
 *  by design. */
export class PolicyEventClient {
  constructor(private client: SynqedClient) {}

  async record(input: {
    staff_id: string
    policy_line: string
    policy_version: number
    event: 'delivered' | 'acknowledged' | 'revoked'
  }): Promise<StaffPolicyEvent> {
    return this.client.fetch<StaffPolicyEvent>('/policy-events', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async list(options?: {
    staff_id?: string
    policy_line?: string
    policy_version?: number
    event?: 'delivered' | 'acknowledged' | 'revoked'
  }): Promise<{ events: StaffPolicyEvent[] }> {
    const params = new URLSearchParams()
    if (options?.staff_id) params.set('staff_id', options.staff_id)
    if (options?.policy_line) params.set('policy_line', options.policy_line)
    if (options?.policy_version) params.set('policy_version', String(options.policy_version))
    if (options?.event) params.set('event', options.event)
    const qs = params.toString()
    return this.client.fetch(`/policy-events${qs ? `?${qs}` : ''}`)
  }

  /** The store-enablement check: latest state for (staff, line, version). */
  async ackState(staffId: string, policyLine: string, policyVersion: number): Promise<{
    delivered: boolean
    acknowledged: boolean
    revoked: boolean
  }> {
    const qs = new URLSearchParams({
      staff_id: staffId,
      policy_line: policyLine,
      policy_version: String(policyVersion),
    })
    return this.client.fetch(`/policy-events/ack-state?${qs}`)
  }
}
