# Staff Cancellation / NO_SHOW (core)

**Date:** 2026-07-05
**Status:** Approved (dedicated audit columns; PATCH /status endpoint)

## Problem

Staff have no way to cancel or mark a no-show on a booking. The app can only
reschedule or hard-delete — deleting corrupts history, and "booked, didn't show"
(a daily event) has no representation. Two gaps:

- `AppointmentStatus` = SCHEDULED / IN_PROGRESS / COMPLETED / CANCELLED — **no
  NO_SHOW**.
- Even if the app sets `status` via `updateAppointment` (the schema already
  allows it), the 15-min QuickReserve crawl **overwrites it**: the found-update /
  adopt paths set `status: 'SCHEDULED'` unconditionally, and
  `markOrphanedCancelled` only excludes `CANCELLED`. A staff cancel flips back.

## Verified current state

- `Appointment` model (`prisma/schema.prisma:197`) has `status`, `source`,
  `externalRefs` (Json), `cancelledAt` — **no audit columns**.
- `updateAppointmentSchema` already accepts `status` (optional).
- `runQuickReserveSync` writes `qrData.status = 'SCHEDULED'` on both found-update
  and adopt (`sync.service.ts` ~437, ~468).
- `markOrphanedCancelled` (`sync.service.ts:763`) `updateMany` sets CANCELLED for
  QUICKRESERVE rows not in `seenIds` with `status != CANCELLED`.
- Visit counting (`customer-enrichment.service.ts:43`):
  `from appointments where business_id = $1 and status <> 'CANCELLED'` — so
  NO_SHOW would count as a visit unless excluded here.

## Decisions

- **Dedicated audit columns** (not JSON, not inference) — satisfies sync-win +
  "everything audited (who/why)" in one.
- **`PATCH /appointments/:id/status`** — a dedicated endpoint, not overloading
  `updateAppointment`.
- No-show burn creates a **flagged** redemption that is excluded from visits.

## Schema (prisma + manual migration)

- `enum AppointmentStatus` += `NO_SHOW`.
- `enum StatusSource { SYSTEM, QR, STAFF }` (new).
- `appointments` new columns:
  - `status_source StatusSource @default(SYSTEM)` — who last set the status.
  - `status_set_by String? @db.Uuid` — acting staff id.
  - `status_reason String?` — free-text why.
  - `status_set_at DateTime? @db.Timestamptz()`.
- `pack_redemptions` new column: `counts_as_visit Boolean @default(true)` — a
  no-show burn writes `false`. (Redemptions don't currently drive visit counts,
  but this makes the "not a visit" guarantee explicit and future-proof.)

Migration is additive; defaults backfill existing rows (`SYSTEM`, `true`) with no
data change.

## Set-status action

`PATCH /v1/appointments/:id/status`
- Body: `{ status: 'CANCELLED' | 'NO_SHOW' | 'SCHEDULED', reason?: string,
  acting_staff_id: string, burn_ticket?: boolean }`.
- Writes `status`, `status_source = STAFF`, `status_set_by = acting_staff_id`,
  `status_reason`, `status_set_at = now()`. Sets `cancelledAt` when terminal,
  clears it when returning to SCHEDULED.
- **Ticket rule:** burns nothing by default. If `burn_ticket === true` (and
  status is NO_SHOW), create **one** `pack_redemption` against the customer's
  active pack with `counts_as_visit = false`, `source = 'no_show'`. If no active
  pack, return a clear error (nothing to burn).
- Scoped to the business (existing middleware). `acting_staff_id` is recorded for
  audit (this is not the item-2 capability gate — that's separate).

## Sync-win (the crux)

- `runQuickReserveSync` found-update **and** adopt paths: before writing
  `qrData`, if `existing.status_source === 'STAFF'` and `existing.status` is
  terminal (`CANCELLED` or `NO_SHOW`), **omit `status` and `cancelledAt`** from
  the update (still refresh title/notes/times/refs). The staff decision wins.
- `markOrphanedCancelled`: add `status_source: { not: 'STAFF' }` to the `where`
  and change the status guard to `status: { notIn: ['CANCELLED', 'NO_SHOW'] }` so
  it never re-touches a staff-set row and never flips a NO_SHOW.

## Visit-stats rule

- `customer-enrichment.service.ts:43`: change
  `status <> 'CANCELLED'` → `status NOT IN ('CANCELLED', 'NO_SHOW')` in both the
  past-appointment count and last/first-visit CTEs. A no-show (burned or not) is
  never a visit.

## Testing (TDD)

- Enum: creating an appointment with `NO_SHOW` succeeds.
- `PATCH /status`: sets status + all four audit columns; `cancelledAt` set on
  terminal, cleared on SCHEDULED.
- Burn: `burn_ticket=true` + NO_SHOW creates exactly one redemption with
  `counts_as_visit=false`; no active pack → error; default (no burn) creates none.
- **Sync-win regression:** seed a QUICKRESERVE appointment, staff-set it
  CANCELLED (status_source=STAFF), run a crawl tick where the feed still returns
  it → status stays CANCELLED (not flipped to SCHEDULED). Same for NO_SHOW.
- `markOrphanedCancelled`: a staff-set NO_SHOW not in seenIds is left untouched.
- Visits: a NO_SHOW appointment is excluded from `dated_visit_count` /
  `past_appointment_count`.

## Out of scope

- The app-side UI (Liam builds on these primitives).
- The item-2 capability gate on who may call PATCH /status (separate work;
  `acting_staff_id` is recorded here for audit regardless).
- Reporting/analytics on cancellation reasons.
