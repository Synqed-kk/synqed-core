import type { SynqedClient } from './client.js'

export interface CoachingConsentDecision {
  id: string
  status: 'granted' | 'declined'
  policy_version: string
  decided_at: string
}
export interface CoachingConsentState {
  current_policy_version: string
  status: 'unset' | 'granted' | 'declined'
  decision: CoachingConsentDecision | null
}

/** Requires the signed-in human's accessToken; an API key alone cannot read or decide. */
export class CoachingConsentClient {
  constructor(private client: SynqedClient) {}

  me(): Promise<CoachingConsentState> {
    return this.client.fetch('/coaching-consent/me')
  }

  decide(input: { status: 'granted' | 'declined'; policy_version: string }): Promise<CoachingConsentDecision> {
    return this.client.fetch('/coaching-consent/me', { method: 'POST', body: JSON.stringify(input) })
  }

  history(cursor?: string): Promise<{ decisions: CoachingConsentDecision[]; next_cursor: string | null }> {
    return this.client.fetch(`/coaching-consent/me/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
  }

  adoption(storeId: string): Promise<{ granted: number; total: number }> {
    return this.client.fetch(`/coaching-consent/stores/${encodeURIComponent(storeId)}/adoption`)
  }
}
