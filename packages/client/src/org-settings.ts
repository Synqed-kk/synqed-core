import type { SynqedClient } from './client.js'
import type { OrgSettings, UpsertOrgSettingsInput } from './types.js'
import { SynqedError } from './client.js'

export class OrgSettingsClient {
  constructor(private client: SynqedClient) {}

  async get(): Promise<OrgSettings | null> {
    try {
      return await this.client.fetch<OrgSettings>('/org-settings')
    } catch (err) {
      if (err instanceof SynqedError && err.status === 404) return null
      throw err
    }
  }

  async upsert(input: UpsertOrgSettingsInput): Promise<OrgSettings> {
    return this.client.fetch<OrgSettings>('/org-settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }
}
