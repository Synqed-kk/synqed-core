import type { SynqedClient } from './client.js'
import type { PricingRules, PricingRuleSet } from './types.js'

/** Dynamic-pricing rule sets: WHEN the price moves inside the menu band.
 *  Versioned per store × menu (menu null = store default); save supersedes,
 *  rollback re-issues an old version as a new one. */
export class PricingClient {
  constructor(private client: SynqedClient) {}

  /** Every ACTIVE set for a store — the BFF's slot-pricing read. */
  async active(storeId: string): Promise<{ rule_sets: PricingRuleSet[] }> {
    return this.client.fetch<{ rule_sets: PricingRuleSet[] }>(
      `/pricing-rules/active?store_id=${encodeURIComponent(storeId)}`,
    )
  }

  async history(storeId: string, menuId?: string | null): Promise<{ rule_sets: PricingRuleSet[] }> {
    const qs = new URLSearchParams({ store_id: storeId })
    if (menuId) qs.set('menu_id', menuId)
    return this.client.fetch<{ rule_sets: PricingRuleSet[] }>(`/pricing-rules/history?${qs}`)
  }

  /** HQ-gated: saves a new version for the scope. */
  async save(input: {
    store_id: string
    menu_id?: string | null
    rules: PricingRules
    acting_staff_id: string
  }): Promise<PricingRuleSet> {
    return this.client.fetch<PricingRuleSet>('/pricing-rules', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /** HQ-gated: one-click rollback (re-issues the chosen version as new). */
  async rollback(ruleSetId: string, actingStaffId: string): Promise<PricingRuleSet> {
    return this.client.fetch<PricingRuleSet>(
      `/pricing-rules/${encodeURIComponent(ruleSetId)}/rollback`,
      { method: 'POST', body: JSON.stringify({ acting_staff_id: actingStaffId }) },
    )
  }
}
