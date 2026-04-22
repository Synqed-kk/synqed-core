import type { SynqedClientConfig } from './types.js'
import { CustomerClient } from './customers.js'
import { StaffClient } from './staff.js'
import { AppointmentClient } from './appointments.js'
import { SyncClient } from './sync.js'

export class SynqedClient {
  private baseUrl: string
  private apiKey: string
  private tenantId: string

  public customers: CustomerClient
  public staff: StaffClient
  public appointments: AppointmentClient
  public sync: SyncClient

  constructor(config: SynqedClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.tenantId = config.tenantId
    this.customers = new CustomerClient(this)
    this.staff = new StaffClient(this)
    this.appointments = new AppointmentClient(this)
    this.sync = new SyncClient(this)
  }

  async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/v1${path}`
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'x-tenant-id': this.tenantId,
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
