// Quick Reserve API client — direct JSON console API (no Puppeteer).
// See docs/RESERVATION_SKIM.md for protocol notes.

const QR_API_BASE = 'https://api.quick-reserve.com/v1/console'

export interface QRReservation {
  id: number
  store_id: number
  customer_id: number
  treatment_course_id: number
  staff_id: number
  booth_id: number
  start_at: number // Unix ms
  end_at: number // Unix ms
  request: string
  deleted: boolean
  rid: string
  is_new_customer_flag: boolean
  nominated_staff_id: number | null
  Customer: {
    id: number
    name: string
    name_kana: string
    phone1: string
    mail1: string
    remarks1: string
    visits_number_cache: number
    is_existing_customer: boolean
  }
  Staff: {
    id: number
    name: string
    name_kana: string
  }
  TreatmentCourse: {
    id: number
    name: string
    duration: number
    price: number
    treatment_category_id: number
  }
}

export interface QRSession {
  token: string
  cookies: string
}

export async function qrLogin(
  storeSlug: string,
  username: string,
  password: string,
): Promise<QRSession> {
  const res = await fetch(`${QR_API_BASE}/${storeSlug}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id: username, password }),
  })

  if (!res.ok) {
    throw new Error(`QR login failed: ${res.status} ${res.statusText}`)
  }

  const cookies = res.headers.get('set-cookie') ?? ''
  let token = ''
  try {
    const data = (await res.json()) as Record<string, unknown>
    token = (data.token as string) ?? (data.access_token as string) ?? (data.jwt as string) ?? ''
  } catch {
    // Token may be cookie-only
  }
  return { token, cookies }
}

function qrHeaders(session: QRSession): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session.token) h['Authorization'] = `Bearer ${session.token}`
  if (session.cookies) h['Cookie'] = session.cookies
  return h
}

export async function qrGetReservations(
  session: QRSession,
  storeSlug: string,
  storeId: number,
  date: string, // YYYY-MM-DD
): Promise<QRReservation[]> {
  const headers = qrHeaders(session)
  const url = `${QR_API_BASE}/${storeSlug}/${storeId}/get-customer-reservations-by-date`

  // QR accepts either YYYY-MM-DD string or unix ms. Try string first.
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ date }),
  })

  if (res.ok) {
    const data = await res.json()
    return Array.isArray(data) ? (data as QRReservation[]) : []
  }

  const dayStartMs = new Date(`${date}T00:00:00+09:00`).getTime()
  const res2 = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ date: dayStartMs }),
  })

  if (res2.ok) {
    const data = await res2.json()
    return Array.isArray(data) ? (data as QRReservation[]) : []
  }

  const body = await res2.text().catch(() => '')
  throw new Error(
    `QR get-reservations-by-date failed: ${res.status} / ${res2.status} — ${body}`,
  )
}

export interface MappedQRReservation {
  qrReservationId: number
  qrRid: string
  qrCustomerId: number
  qrStaffId: number
  customerName: string
  customerKana: string
  customerPhone: string
  customerEmail: string
  customerNotes: string
  customerVisitsCached: number
  isNewCustomer: boolean
  staffName: string
  treatmentName: string
  treatmentId: number
  startsAt: Date
  endsAt: Date
  durationMinutes: number
  deleted: boolean
}

export function mapReservation(r: QRReservation): MappedQRReservation {
  return {
    qrReservationId: r.id,
    qrRid: r.rid,
    qrCustomerId: r.Customer.id,
    qrStaffId: r.Staff.id,
    customerName: r.Customer.name,
    customerKana: r.Customer.name_kana ?? '',
    customerPhone: r.Customer.phone1 ?? '',
    customerEmail: r.Customer.mail1 ?? '',
    customerNotes: r.Customer.remarks1 ?? '',
    customerVisitsCached: r.Customer.visits_number_cache ?? 0,
    isNewCustomer: r.is_new_customer_flag || !r.Customer.is_existing_customer,
    staffName: r.Staff.name,
    treatmentName: r.TreatmentCourse.name,
    treatmentId: r.TreatmentCourse.id,
    startsAt: new Date(r.start_at),
    endsAt: new Date(r.end_at),
    durationMinutes: Math.round((r.end_at - r.start_at) / 60000),
    deleted: r.deleted,
  }
}
