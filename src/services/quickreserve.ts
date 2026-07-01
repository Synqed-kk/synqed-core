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
  // QR changed the reservation payload (2026-06): the old PascalCase
  // Customer/Staff/TreatmentCourse objects are GONE. The customer is now a
  // resolved id + name only (no phone/email/kana/visits on the reservation);
  // staff and treatment_course are lowercase nested objects.
  // Nullable: QR's non-booking rows (休憩/block/closed slot) carry no resolved
  // customer or course — the sync skips those, so keep this honestly nullable.
  resolvedCustomerId: number | null
  resolvedCustomerName: string
  staff: {
    id: number
    name: string
    name_kana: string
  } | null
  treatment_course: {
    id: number
    name: string
    duration: number
    price: number
  } | null
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
    // A valid array (even empty []) is a real answer — return it. A 200 OK
    // whose body is NOT an array is a soft-failure (error envelope, HTML
    // interstitial, null): THROW so the sync treats it as a failed fetch, not
    // as "zero reservations" — otherwise an empty feed would trip orphan
    // cancellation and wipe the day's bookings.
    if (Array.isArray(data)) return data as QRReservation[]
    throw new Error(
      `QR get-reservations: 200 OK but body was not an array (got ${typeof data}) — treating as a failed fetch, not an empty day.`,
    )
  }

  const dayStartMs = new Date(`${date}T00:00:00+09:00`).getTime()
  const res2 = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ date: dayStartMs }),
  })

  if (res2.ok) {
    const data = await res2.json()
    // A valid array (even empty []) is a real answer — return it. A 200 OK
    // whose body is NOT an array is a soft-failure (error envelope, HTML
    // interstitial, null): THROW so the sync treats it as a failed fetch, not
    // as "zero reservations" — otherwise an empty feed would trip orphan
    // cancellation and wipe the day's bookings.
    if (Array.isArray(data)) return data as QRReservation[]
    throw new Error(
      `QR get-reservations: 200 OK but body was not an array (got ${typeof data}) — treating as a failed fetch, not an empty day.`,
    )
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
    // Stable QR customer id — the real identity key. Now surfaced as
    // resolvedCustomerId rather than an embedded Customer object.
    qrCustomerId: r.resolvedCustomerId ?? r.customer_id,
    qrStaffId: r.staff?.id ?? r.staff_id,
    customerName: r.resolvedCustomerName ?? '',
    // Phone / email / kana / visit-count are no longer on the reservation —
    // customer matching falls back to id/name; enrichment is a separate sync.
    customerKana: '',
    customerPhone: '',
    customerEmail: '',
    customerNotes: r.request ?? '',
    customerVisitsCached: 0,
    isNewCustomer: r.is_new_customer_flag,
    staffName: r.staff?.name ?? '',
    treatmentName: r.treatment_course?.name ?? '',
    treatmentId: r.treatment_course?.id ?? r.treatment_course_id,
    startsAt: new Date(r.start_at),
    endsAt: new Date(r.end_at),
    durationMinutes: Math.round((r.end_at - r.start_at) / 60000),
    deleted: r.deleted,
  }
}
