import { describe, it, expect } from 'vitest'
import { mapReservation } from '../src/services/quickreserve.js'

// QR changed its reservation payload (2026-06): the PascalCase
// Customer/Staff/TreatmentCourse objects are GONE — the customer is now
// resolvedCustomerId/resolvedCustomerName and staff/treatment_course are
// lowercase nullable objects. Core still read the old shape → the daily sync
// 502'd with "Cannot read properties of undefined (reading 'id')".
const booking = {
  id: 1,
  store_id: 222,
  customer_id: 999,
  treatment_course_id: 5,
  staff_id: 7,
  booth_id: 1,
  start_at: 1780000000000,
  end_at: 1780003600000,
  request: 'メモ',
  deleted: false,
  rid: 'r1',
  is_new_customer_flag: false,
  nominated_staff_id: null,
  resolvedCustomerId: 12345,
  resolvedCustomerName: '山田花子',
  staff: { id: 7, name: '佐藤', name_kana: 'サトウ' },
  treatment_course: { id: 5, name: 'カット', duration: 3600000, price: 5000 },
  bill: null,
}

describe('mapReservation (post-2026-06 QR shape)', () => {
  it('reads resolved/lowercase fields, not PascalCase Customer/Staff/TreatmentCourse', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = mapReservation(booking as any)
    expect(m.qrReservationId).toBe(1)
    expect(m.qrCustomerId).toBe(12345)
    expect(m.customerName).toBe('山田花子')
    expect(m.staffName).toBe('佐藤')
    expect(m.treatmentName).toBe('カット')
    expect(m.treatmentId).toBe(5)
  })

  it('does not throw on a non-booking row (休憩/block: staff + course null)', () => {
    const block = {
      ...booking,
      resolvedCustomerId: null,
      resolvedCustomerName: '',
      staff: null,
      treatment_course: null,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => mapReservation(block as any)).not.toThrow()
  })
})
