import type { SynqedClient } from './client.js'
import type {
  RetentionSignal,
  CreateRetentionSignalInput,
  ListRetentionSignalsOptions,
} from './types.js'

/** Retention-signal store (neutral name by legal ruling). Hard deletes are
 *  deliberate: dismiss/delete ERASE content; write your audit events
 *  (ids + flags only) before calling them. The app owns the capability gate
 *  on every read. */
export class RetentionSignalClient {
  constructor(private client: SynqedClient) {}

  /** Detection pass write — creates a pending row (14-day review TTL). */
  async create(input: CreateRetentionSignalInput): Promise<RetentionSignal> {
    return this.client.fetch<RetentionSignal>('/retention-signals', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async list(options?: ListRetentionSignalsOptions): Promise<{
    signals: RetentionSignal[]
    total: number
    page: number
    page_size: number
  }> {
    const params = new URLSearchParams()
    if (options?.status) params.set('status', options.status)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch(`/retention-signals${qs ? `?${qs}` : ''}`)
  }

  /** Manager confirm — stamps who/when, starts the retention clock. Idempotent. */
  async confirm(id: string, managerStaffId: string): Promise<RetentionSignal> {
    return this.client.fetch<RetentionSignal>(
      `/retention-signals/${encodeURIComponent(id)}/confirm`,
      { method: 'POST', body: JSON.stringify({ manager_staff_id: managerStaffId }) },
    )
  }

  /** HARD delete + anonymized counter — the reviewer says the AI was wrong. */
  async dismiss(id: string): Promise<{ ok: boolean }> {
    return this.client.fetch<{ ok: boolean }>(
      `/retention-signals/${encodeURIComponent(id)}/dismiss`,
      { method: 'POST' },
    )
  }

  /** HARD delete, no counter — statutory demand / retention clock. */
  async delete(id: string): Promise<{ ok: boolean }> {
    return this.client.fetch<{ ok: boolean }>(
      `/retention-signals/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
  }

  /** Anonymized over-firing audit: counts per (criterion, confidence). */
  async dismissalCounters(): Promise<{
    counters: Array<{ criterion: string; confidence: string; count: number }>
  }> {
    return this.client.fetch('/retention-signals/dismissal-counters')
  }
}
