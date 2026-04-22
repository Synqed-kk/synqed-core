import type { SynqedClient } from './client.js'
import type {
  SyncConfig,
  SyncProvider,
  UpsertSyncConfigInput,
  SyncRunResult,
} from './types.js'

export class SyncClient {
  constructor(private client: SynqedClient) {}

  private providerPath(provider: SyncProvider): string {
    return provider.toLowerCase()
  }

  async getConfig(provider: SyncProvider): Promise<SyncConfig | null> {
    try {
      return await this.client.fetch<SyncConfig>(`/sync/${this.providerPath(provider)}/config`)
    } catch (err) {
      // 404 → not configured yet
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
        return null
      }
      throw err
    }
  }

  async upsertConfig(
    provider: SyncProvider,
    input: UpsertSyncConfigInput,
  ): Promise<SyncConfig> {
    return this.client.fetch<SyncConfig>(`/sync/${this.providerPath(provider)}/config`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  async runNow(provider: SyncProvider): Promise<SyncRunResult> {
    return this.client.fetch<SyncRunResult>(`/sync/${this.providerPath(provider)}/run`, {
      method: 'POST',
    })
  }
}
