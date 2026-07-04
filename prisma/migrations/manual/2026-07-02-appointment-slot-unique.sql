-- One booking per customer-slot: dedup existing duplicates, then enforce.
--
-- Problem: the QuickReserve crawl created a second appointment for a visit that
-- already existed as a manual booking ("one visit showing as two bookings").
-- The crawl matched only its own QR-id twins, never a pre-existing manual row
-- at the same slot, so every reservation whose visit was already on the
-- calendar produced a duplicate.
--
-- Fix (two parts; this file is the data half):
--   1. Collapse existing duplicates. Keeper = the row carrying the QuickReserve
--      reservationId (the live source) when the group has one, else the oldest.
--   2. Add UNIQUE(business_id, customer_id, starts_at) so a duplicate can never
--      be inserted again. A genuine back-to-back double session has a DIFFERENT
--      starts_at and is unaffected. The crawl's adopt-on-conflict (P2002) path
--      in runQuickReserveSync now claims the existing row instead of duplicating.
--
-- Safety: an orphan guard runs BEFORE the DELETE (below) and ABORTS the whole
-- migration if any to-be-deleted row is referenced by pack_redemptions,
-- karute_records, recording_sessions or visit_reconcile_dismissals — none of
-- which declare an FK back to appointments, so a plain DELETE would otherwise
-- silently orphan them. This was hand-verified for the 58 dup groups present on
-- 2026-07-02, but prod drifts (78 groups by 2026-07-03); the in-file guard makes
-- the migration self-checking regardless of when it is run. Keeper = the QR row,
-- so the deleted row is the MANUAL twin — the one MORE likely to carry a karute
-- record or recording, which is exactly why the guard matters.
--
-- Deploy order: apply this migration and deploy the adopt-on-conflict code
-- together so the UNIQUE constraint always has the adopt handler behind it.

BEGIN;

-- Rows the dedup would remove (rn > 1 = every twin except the keeper).
CREATE TEMP TABLE _appt_to_delete ON COMMIT DROP AS
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, customer_id, starts_at
           ORDER BY (external_refs -> 'quickreserve' ->> 'reservationId') IS NOT NULL DESC,
                    created_at ASC
         ) AS rn
  FROM appointments
)
SELECT id FROM ranked WHERE rn > 1;

-- Orphan guard: abort if any to-be-deleted row has child records. Casts differ
-- because karute_records/recording_sessions.appointment_id are uuid while
-- pack_redemptions/visit_reconcile_dismissals.appointment_id are text.
DO $$
DECLARE referenced int;
BEGIN
  SELECT count(*) INTO referenced FROM _appt_to_delete d WHERE
       EXISTS (SELECT 1 FROM pack_redemptions        r WHERE r.appointment_id = d.id::text)
    OR EXISTS (SELECT 1 FROM karute_records          k WHERE k.appointment_id = d.id)
    OR EXISTS (SELECT 1 FROM recording_sessions      s WHERE s.appointment_id = d.id)
    OR EXISTS (SELECT 1 FROM visit_reconcile_dismissals v WHERE v.appointment_id = d.id::text);
  IF referenced > 0 THEN
    RAISE EXCEPTION 'Aborting dedup: % duplicate appointment(s) marked for deletion are referenced by child records. Re-point those children to the keeper row (or change the keeper preference) before re-running.', referenced;
  END IF;
END $$;

DELETE FROM appointments a
USING _appt_to_delete d
WHERE a.id = d.id;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_business_id_customer_id_starts_at_key
  UNIQUE (business_id, customer_id, starts_at);

COMMIT;
