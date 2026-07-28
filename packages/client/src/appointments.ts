import type { SynqedClient } from './client.js'
import type {
  AuditEventInput,
  Appointment,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  ListAppointmentsOptions,
  ListAppointmentsResponse,
} from './types.js'

export class AppointmentClient {
  constructor(private client: SynqedClient) {}

  async list(options?: ListAppointmentsOptions): Promise<ListAppointmentsResponse> {
    const params = new URLSearchParams()
    if (options?.from) params.set('from', options.from)
    if (options?.to) params.set('to', options.to)
    if (options?.store_id) params.set('store_id', options.store_id)
    if (options?.staff_id) params.set('staff_id', options.staff_id)
    if (options?.customer_id) params.set('customer_id', options.customer_id)
    if (options?.status) params.set('status', options.status)
    if (options?.source) params.set('source', options.source)
    if (options?.page) params.set('page', String(options.page))
    if (options?.page_size) params.set('page_size', String(options.page_size))
    const qs = params.toString()
    return this.client.fetch<ListAppointmentsResponse>(`/appointments${qs ? `?${qs}` : ''}`)
  }

  async get(id: string): Promise<Appointment> {
    return this.client.fetch<Appointment>(`/appointments/${id}`)
  }

  async create(
    input: CreateAppointmentInput,
    options?: { idempotencyKey?: string },
  ): Promise<Appointment> {
    return this.client.fetch<Appointment>('/appointments', {
      method: 'POST',
      body: JSON.stringify(input),
      // Same key on a retry replays the created appointment (200) instead of
      // double-booking; core stores the key server-side.
      ...(options?.idempotencyKey
        ? { headers: { 'Idempotency-Key': options.idempotencyKey } }
        : {}),
    })
  }

  /** options.audit (A1): the audit row commits in the SAME core transaction
   *  as the booking change — replaces the separate audit.log() call. */
  async update(
    id: string,
    input: UpdateAppointmentInput,
    options?: { audit?: AuditEventInput },
  ): Promise<Appointment> {
    const body = options?.audit ? { ...input, audit: options.audit } : input
    return this.client.fetch<Appointment>(`/appointments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  async delete(id: string): Promise<void> {
    await this.client.fetch(`/appointments/${id}`, { method: 'DELETE' })
  }
}
