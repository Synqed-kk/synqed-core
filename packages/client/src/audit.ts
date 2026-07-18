import type { SynqedClient } from './client.js'
import type {
  AuditEventInput,
  AuditEvent,
  ListAuditOptions,
  ListAuditResponse,
} from './types.js'

/** The 監査ログ — ONE write path for app and core. Append-only server-side;
 *  erasure happens only through the customer-deletion scrub. */
export class AuditClient {
  constructor(private client: SynqedClient) {}

  /** Record an audit event (who did what to which target). */
  async log(input: AuditEventInput): Promise<AuditEvent> {
    return this.client.fetch<AuditEvent>('/audit', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /** Owner-only 監査ログ read: newest first, filterable. */
  async list(options?: ListAuditOptions): Promise<ListAuditResponse> {
    const params = new URLSearchParams()
    if (options?.category) params.set('category', options.category)
    if (options?.actor_id) params.set('actor_id', options.actor_id)
    if (options?.target_type) params.set('target_type', options.target_type)
    if (options?.target_id) params.set('target_id', options.target_id)
    if (options?.break_glass !== undefined) params.set('break_glass', String(options.break_glass))
    if (options?.from) params.set('from', options.from)
    if (options?.to) params.set('to', options.to)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch<ListAuditResponse>(`/audit${qs ? `?${qs}` : ''}`)
  }
}
