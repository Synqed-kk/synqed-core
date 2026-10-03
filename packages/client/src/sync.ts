import type { SynqedClient } from './client.js'
import type {
  SyncConfig,
  SyncProvider,
  UpsertSyncConfigInput,
  SyncRunResult,
  SyncRunAllResult,
} from './types.js'

export class SyncClient {
  constructor(private client: SynqedClient) {}

  private providerPath(provider: SyncProvider): string {
    return provider.toLowerCase()
  }

  /** Every store's row for this provider, oldest first. No secrets. */
  async listConfigs(provider: SyncProvider): Promise<SyncConfig[]> {
    const res = await this.client.fetch<{ configs: SyncConfig[] }>(
      `/sync/${this.providerPath(provider)}/configs`,
    )
    return res.configs
  }

  /** The primary store's row (or the only row). Prefer listConfigs. */
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

  /** Run one store's row. Without a store, runs the primary store's row. */
  async runNow(
    provider: SyncProvider,
    opts?: { karute_store_id?: string },
  ): Promise<SyncRunResult> {
    return this.client.fetch<SyncRunResult>(`/sync/${this.providerPath(provider)}/run`, {
      method: 'POST',
      ...(opts?.karute_store_id
        ? { body: JSON.stringify({ karute_store_id: opts.karute_store_id }) }
        : {}),
    })
  }

  /** Run every store's row, one after the other. */
  async runAll(provider: SyncProvider): Promise<SyncRunAllResult> {
    return this.client.fetch<SyncRunAllResult>(`/sync/${this.providerPath(provider)}/run`, {
      method: 'POST',
      body: JSON.stringify({ all: true }),
    })
  }
}
