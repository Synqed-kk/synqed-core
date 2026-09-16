import type { SynqedClient } from './client.js'
import type {
  StoreBookingPolicy,
  SetStoreBookingPolicyInput,
  StoreClosedDay,
  AddClosedDayInput,
} from './types.js'

/** Structured refusal codes exposed on SynqedError.code by policy writes. */
export const STORE_POLICY_WRITE_ERROR_CODES = [
  'acting_staff_not_in_business',
  'acting_staff_role_forbidden',
  'store_not_found',
] as const
export type StorePolicyWriteErrorCode = (typeof STORE_POLICY_WRITE_ERROR_CODES)[number]

/** Narrow SynqedError.code after catching a store-policy write refusal. */
export function isStorePolicyWriteErrorCode(value: unknown): value is StorePolicyWriteErrorCode {
  return typeof value === 'string' && STORE_POLICY_WRITE_ERROR_CODES.includes(value as StorePolicyWriteErrorCode)
}

/** Per-store booking-acceptance policy: horizon, cutoff, cancellation terms.
 *  Absent row = platform defaults (source: 'default'). */
export class StorePolicyClient {
  constructor(private client: SynqedClient) {}

  async list(): Promise<{ policies: StoreBookingPolicy[] }> {
    return this.client.fetch<{ policies: StoreBookingPolicy[] }>('/store-policies')
  }

  /** The BFF calendar read: one store's effective policy. */
  async get(storeId: string): Promise<StoreBookingPolicy> {
    return this.client.fetch<StoreBookingPolicy>(`/store-policies/${encodeURIComponent(storeId)}`)
  }

  /** OWNER-only partial upsert; acting_staff_id must be a core staff.id.
   * @throws SynqedError with a StorePolicyWriteErrorCode on actor/store refusal. */
  async set(storeId: string, input: SetStoreBookingPolicyInput): Promise<StoreBookingPolicy> {
    return this.client.fetch<StoreBookingPolicy>(`/store-policies/${encodeURIComponent(storeId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  /** Ad-hoc closed days (臨時休業); optional YYYY-MM-DD range (to exclusive). */
  async listClosedDays(
    storeId: string,
    range?: { from?: string; to?: string },
  ): Promise<{ closed_days: StoreClosedDay[] }> {
    const params = new URLSearchParams()
    if (range?.from) params.set('from', range.from)
    if (range?.to) params.set('to', range.to)
    const qs = params.toString()
    return this.client.fetch<{ closed_days: StoreClosedDay[] }>(
      `/store-policies/${encodeURIComponent(storeId)}/closed-days${qs ? `?${qs}` : ''}`,
    )
  }

  /** OWNER-only; 409 when the date is already closed.
   * @throws SynqedError with a StorePolicyWriteErrorCode on actor/store refusal. */
  async addClosedDay(storeId: string, input: AddClosedDayInput): Promise<StoreClosedDay> {
    return this.client.fetch<StoreClosedDay>(
      `/store-policies/${encodeURIComponent(storeId)}/closed-days`,
      { method: 'POST', body: JSON.stringify(input) },
    )
  }

  /** OWNER-only remove; actingStaffId must be a core staff.id.
   * @throws SynqedError with a StorePolicyWriteErrorCode on actor/store refusal. */
  async removeClosedDay(storeId: string, id: string, actingStaffId: string): Promise<void> {
    await this.client.fetch(
      `/store-policies/${encodeURIComponent(storeId)}/closed-days/${encodeURIComponent(id)}?acting_staff_id=${encodeURIComponent(actingStaffId)}`,
      { method: 'DELETE' },
    )
  }
}
