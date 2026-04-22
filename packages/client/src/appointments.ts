import type { SynqedClient } from './client.js'
import type {
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

  async create(input: CreateAppointmentInput): Promise<Appointment> {
    return this.client.fetch<Appointment>('/appointments', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async update(id: string, input: UpdateAppointmentInput): Promise<Appointment> {
    return this.client.fetch<Appointment>(`/appointments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  async delete(id: string): Promise<void> {
    await this.client.fetch(`/appointments/${id}`, { method: 'DELETE' })
  }
}
