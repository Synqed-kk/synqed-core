import type { SynqedClientConfig } from './types.js'
import { CustomerClient } from './customers.js'
import { StaffClient } from './staff.js'
import { AppointmentClient } from './appointments.js'
import { SyncClient } from './sync.js'
import { RecordingClient } from './recordings.js'
import { KaruteRecordClient } from './karute.js'
import { OrgSettingsClient } from './org-settings.js'
import { AiRateLimitClient } from './ai-rate-limit.js'

export class SynqedClient {
  private baseUrl: string
  private apiKey: string
  private businessId: string

  public customers: CustomerClient
  public staff: StaffClient
  public appointments: AppointmentClient
  public sync: SyncClient
  public recordings: RecordingClient
  public karuteRecords: KaruteRecordClient
  public orgSettings: OrgSettingsClient
  public aiRateLimit: AiRateLimitClient

  constructor(config: SynqedClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.businessId = config.businessId
    this.customers = new CustomerClient(this)
    this.staff = new StaffClient(this)
    this.appointments = new AppointmentClient(this)
    this.sync = new SyncClient(this)
    this.recordings = new RecordingClient(this)
    this.karuteRecords = new KaruteRecordClient(this)
    this.orgSettings = new OrgSettingsClient(this)
    this.aiRateLimit = new AiRateLimitClient(this)
  }

  async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/v1${path}`
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'x-business-id': this.businessId,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    }

    const res = await fetch(url, { ...init, headers })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new SynqedError(res.status, body.error ?? 'Request failed')
    }

    return res.json() as Promise<T>
  }

  async fetchMultipart<T>(path: string, formData: FormData): Promise<T> {
    const url = `${this.baseUrl}/v1${path}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'x-business-id': this.businessId,
        // NO Content-Type — fetch sets multipart boundary automatically
      },
      body: formData,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new SynqedError(res.status, body.error ?? 'Request failed')
    }
    return res.json() as Promise<T>
  }
}

export class SynqedError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SynqedError'
  }
}
