# Staff Cancellation / NO_SHOW Implementation Plan

> **For agentic workers:** implement task-by-task, TDD, commit per task.

**Goal:** staff can cancel / no-show a booking (row kept), it survives the QR crawl, is audited, and can optionally burn one flagged (non-visit) ticket.

**Tech Stack:** synqed-core (Hono + Prisma + Postgres), Vitest integration tests.

## Global Constraints

- Migration additive only; existing rows default `status_source=SYSTEM`, `counts_as_visit=true`.
- Sync-win: crawl must NEVER overwrite a `status_source=STAFF` terminal status.
- No-show is never a visit (burned or not).
- Tests are integration (real test DB) via `app.request`; run `npx vitest run tests/<f>`.

---

### Task 1: Schema — NO_SHOW, StatusSource, audit columns, counts_as_visit

**Files:** `prisma/schema.prisma`; `prisma/migrations/manual/2026-07-05-appointment-status-audit.sql`

- [ ] Add `NO_SHOW` to `enum AppointmentStatus`; add `enum StatusSource { SYSTEM QR STAFF }`.
- [ ] On `Appointment`: `statusSource StatusSource @default(SYSTEM) @map("status_source")`, `statusSetBy String? @map("status_set_by") @db.Uuid`, `statusReason String? @map("status_reason")`, `statusSetAt DateTime? @map("status_set_at") @db.Timestamptz()`.
- [ ] On `PackRedemption`: `countsAsVisit Boolean @default(true) @map("counts_as_visit")`.
- [ ] Manual migration SQL: `ALTER TYPE "AppointmentStatus" ADD VALUE 'NO_SHOW'`; `CREATE TYPE "StatusSource" AS ENUM('SYSTEM','QR','STAFF')`; `ALTER TABLE appointments ADD COLUMN ...` (4 cols); `ALTER TABLE pack_redemptions ADD COLUMN counts_as_visit boolean NOT NULL DEFAULT true`.
- [ ] `npx prisma generate`; typecheck.
- [ ] Apply migration to prod DB (additive, safe). Commit.

### Task 2: `setAppointmentStatus` service + PATCH route

**Files:** `src/services/appointment.service.ts`, `src/routes/appointments.ts`, `src/validations/appointment.ts`; Test: `tests/appointment-status.test.ts`

**Interfaces:** `setAppointmentStatus(businessId, id, { status, reason?, actingStaffId, burnTicket? }): Promise<AppointmentPublic>`

- [ ] Test (failing): PATCH `/appointments/:id/status` `{status:'CANCELLED', acting_staff_id}` → row status CANCELLED, `status_source=STAFF`, `status_set_by`, `status_set_at` set, `cancelledAt` set. SCHEDULED clears `cancelledAt`.
- [ ] Validation schema `setStatusSchema` (status in CANCELLED/NO_SHOW/SCHEDULED, acting_staff_id uuid, reason? , burn_ticket? bool).
- [ ] Service writes status + audit cols; cancelledAt = now() on terminal, null on SCHEDULED.
- [ ] Route `PATCH /:id/status`. Run → pass. Commit.

### Task 3: No-show ticket burn (flagged, non-visit)

**Files:** `src/services/appointment.service.ts` (+ packs); Test: same file

- [ ] Test: `burn_ticket=true`+NO_SHOW → exactly one `pack_redemption` for the customer's active pack, `counts_as_visit=false`, `source='no_show'`; no active pack → 4xx error; default (no burn) → zero redemptions.
- [ ] Implement: find active pack for customer; create redemption `{ countsAsVisit:false, source:'no_show', appointmentId }`; guard no-pack. Run → pass. Commit.

### Task 4: Sync-win — crawl preserves staff-set terminal status

**Files:** `src/services/sync.service.ts`; Test: `tests/sync-status-win.test.ts`

- [ ] Test (the key regression): seed QUICKRESERVE appt, set `status_source=STAFF status=CANCELLED`; run the found-update path with the feed still returning it → status stays CANCELLED. Same for NO_SHOW.
- [ ] In found-update + adopt: if `existing.statusSource==='STAFF'` && `existing.status` in (CANCELLED,NO_SHOW), build the update data WITHOUT `status`/`cancelledAt` (keep title/notes/times/refs). Run → pass. Commit.

### Task 5: markOrphanedCancelled ignores staff-set + NO_SHOW

**Files:** `src/services/sync.service.ts`; Test: `tests/sync-status-win.test.ts`

- [ ] Test: a staff-set NO_SHOW not in seenIds is left untouched by a crawl tick.
- [ ] Change `where`: add `statusSource: { not: 'STAFF' }`; `status: { notIn: ['CANCELLED','NO_SHOW'] }`. Run → pass. Commit.

### Task 6: Visits exclude NO_SHOW

**Files:** `src/services/customer-enrichment.service.ts`; Test: `tests/enrichment-noshow.test.ts`

- [ ] Test: a NO_SHOW appointment is not counted in `dated_visit_count`/`past_appointment_count`.
- [ ] Change SQL `status <> 'CANCELLED'` → `status NOT IN ('CANCELLED','NO_SHOW')` in the relevant CTEs. Run → pass. Commit.

### Task 7: Full suite + PR

- [ ] `npx vitest run` (all green). Open PR; Greptile → 5/5; merge; apply migration to prod if not already.

## Self-Review
- Spec coverage: enum(T1), endpoint(T2), burn(T3), sync-win(T4/T5), visits(T6). Covered.
- No placeholders. Types consistent (`setAppointmentStatus`, `statusSource`).
