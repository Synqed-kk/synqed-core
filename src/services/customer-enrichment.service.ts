import { prisma } from '../db/client.js'

// Per-customer list-badge enrichment, computed in ONE SQL aggregation instead of
// the app downloading the whole tenant's karute+appointments+staff and bucketing
// in JS. Replicates src/lib/customers/list-enrich.ts exactly:
//   - karute "visit date" = created_at; appointments exclude CANCELLED
//   - last_visit  = karute max(created_at) IF any karute, else most-recent past appt
//   - first_visit = MIN of (karute min, earliest past appt)   [true min of both]
//   - dated_visit_count = karute count + past-appt count
//   - 担当 (booking_staff) = nearest UPCOMING booking's staff, else most-recent
//     past booking's staff, translated synqed staff_id → staff.user_id (profile id)

export interface CustomerEnrichmentRow {
  customer_id: string
  total_karute: number
  last_visit: string | null
  first_visit: string | null
  past_appointment_count: number
  last_visit_service: string | null
  booking_staff_id: string | null
  next_appointment: string | null
  dated_visit_count: number
}

interface Raw {
  customer_id: string
  total_karute: number
  last_visit: Date | null
  first_visit: Date | null
  past_appointment_count: number
  last_visit_service: string | null
  booking_staff_id: string | null
  next_appointment: Date | null
  dated_visit_count: number
}

export async function customerEnrichment(businessId: string): Promise<CustomerEnrichmentRow[]> {
  const rows = await prisma.$queryRawUnsafe<Raw[]>(
    `
    with appt as (
      select customer_id, starts_at, title, staff_id
      from appointments
      where business_id = $1::uuid and status::text not in ('CANCELLED', 'NO_SHOW')
    ),
    kar as (
      select customer_id, created_at
      from karute_records
      where business_id = $1::uuid and customer_id is not null
    ),
    kar_agg as (
      select customer_id, count(*)::int n, max(created_at) last, min(created_at) first
      from kar group by customer_id
    ),
    past as ( select customer_id, starts_at, title, staff_id from appt where starts_at < now() ),
    past_agg as (
      select customer_id, count(*)::int n, max(starts_at) last, min(starts_at) first
      from past group by customer_id
    ),
    last_past as (
      select distinct on (customer_id) customer_id, title, staff_id
      from past order by customer_id, starts_at desc
    ),
    next_appt as (
      select distinct on (customer_id) customer_id, starts_at, staff_id
      from appt where starts_at >= now() order by customer_id, starts_at asc
    ),
    ids as ( select customer_id from kar_agg union select customer_id from appt )
    select
      i.customer_id::text as customer_id,
      coalesce(ka.n, 0) as total_karute,
      coalesce(ka.last, pa.last) as last_visit,
      least(ka.first, pa.first) as first_visit,
      coalesce(pa.n, 0) as past_appointment_count,
      lp.title as last_visit_service,
      na.starts_at as next_appointment,
      coalesce(ka.n, 0) + coalesce(pa.n, 0) as dated_visit_count,
      coalesce(st.user_id::text, coalesce(na.staff_id, lp.staff_id)::text) as booking_staff_id
    from (select distinct customer_id from ids) i
    left join kar_agg  ka on ka.customer_id = i.customer_id
    left join past_agg pa on pa.customer_id = i.customer_id
    left join last_past lp on lp.customer_id = i.customer_id
    left join next_appt na on na.customer_id = i.customer_id
    left join staff st on st.id = coalesce(na.staff_id, lp.staff_id)
    `,
    businessId,
  )
  return rows.map((r) => ({
    customer_id: r.customer_id,
    total_karute: r.total_karute,
    last_visit: r.last_visit ? r.last_visit.toISOString() : null,
    first_visit: r.first_visit ? r.first_visit.toISOString() : null,
    past_appointment_count: r.past_appointment_count,
    last_visit_service: r.last_visit_service,
    booking_staff_id: r.booking_staff_id,
    next_appointment: r.next_appointment ? r.next_appointment.toISOString() : null,
    dated_visit_count: r.dated_visit_count,
  }))
}
