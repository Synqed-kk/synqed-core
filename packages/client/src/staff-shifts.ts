import type { SynqedClient } from './client.js'
import type { StaffShift, CreateStaffShiftInput, UpdateStaffShiftInput, ListStaffShiftsOptions, ListStaffShiftsResponse } from './types.js'

export class StaffShiftClient {
  constructor(private client: SynqedClient) {}
  async list(options?: ListStaffShiftsOptions): Promise<ListStaffShiftsResponse> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(options ?? {})) {
      if (value !== undefined) params.set(key, String(value))
    }
    const query = params.toString()
    return this.client.fetch(`/staff-shifts${query ? `?${query}` : ''}`)
  }
  async get(id: string): Promise<StaffShift> { return this.client.fetch(`/staff-shifts/${id}`) }
  async create(input: CreateStaffShiftInput): Promise<StaffShift> {
    return this.client.fetch('/staff-shifts', { method: 'POST', body: JSON.stringify(input) })
  }
  async update(id: string, input: UpdateStaffShiftInput): Promise<StaffShift> {
    return this.client.fetch(`/staff-shifts/${id}`, { method: 'PUT', body: JSON.stringify(input) })
  }
  async delete(id: string): Promise<void> { await this.client.fetch(`/staff-shifts/${id}`, { method: 'DELETE' }) }
}
