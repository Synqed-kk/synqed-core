import type { SynqedClient } from './client.js'
import type { Qualification } from './types.js'

/** Treatment qualifications (bed plane phase 2 item 7): per-business labels
 *  staff hold and menus may require. Informational — readers filter bookable
 *  staff by them; core does not enforce at booking time. Retire via
 *  active:false — no delete (menus reference them). */
export class QualificationClient {
  constructor(private client: SynqedClient) {}

  async list(options?: { active?: boolean }): Promise<{ qualifications: Qualification[] }> {
    const qs = options?.active !== undefined ? `?active=${options.active}` : ''
    return this.client.fetch<{ qualifications: Qualification[] }>(`/qualifications${qs}`)
  }

  /** 409 when the name is taken. */
  async create(input: { name: string }): Promise<Qualification> {
    return this.client.fetch<Qualification>('/qualifications', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /** Rename / retire (active:false). */
  async update(id: string, input: { name?: string; active?: boolean }): Promise<Qualification> {
    return this.client.fetch<Qualification>(`/qualifications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  /** Every staff→qualification link in one call, keyed by the staff card id. */
  async listAllStaff(): Promise<{ assignments: Record<string, string[]> }> {
    return this.client.fetch<{ assignments: Record<string, string[]> }>('/qualifications/staff')
  }

  /** The qualification ids one staff member holds (card id or profile id). */
  async getStaff(staffId: string): Promise<{ qualification_ids: string[] }> {
    return this.client.fetch<{ qualification_ids: string[] }>(
      `/qualifications/staff/${encodeURIComponent(staffId)}`,
    )
  }

  /** Replace a staff member's full qualification set. */
  async setStaff(staffId: string, qualificationIds: string[]): Promise<{ ok: true }> {
    return this.client.fetch<{ ok: true }>(
      `/qualifications/staff/${encodeURIComponent(staffId)}`,
      { method: 'PUT', body: JSON.stringify({ qualification_ids: qualificationIds }) },
    )
  }
}
