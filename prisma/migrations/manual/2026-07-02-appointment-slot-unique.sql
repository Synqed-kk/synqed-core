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
-- Safety verified against prod 2026-07-02: 58 duplicate groups (2 rows each) →
-- 58 rows deleted; 0 pack_redemptions, karute_records, recording_sessions or
-- visit_reconcile_dismissals reference any deleted row, so nothing is orphaned.
--
-- Deploy order: ship the code (adopt-on-conflict) BEFORE this migration is not
-- required — the migration is self-contained (keeps the QR row, so no re-create
-- gap) — but do apply this migration and deploy the code together so the
-- constraint always has the adopt handler behind it.

BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, customer_id, starts_at
           ORDER BY (external_refs -> 'quickreserve' ->> 'reservationId') IS NOT NULL DESC,
                    created_at ASC
         ) AS rn
  FROM appointments
)
DELETE FROM appointments a
USING ranked
WHERE a.id = ranked.id
  AND ranked.rn > 1;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_business_id_customer_id_starts_at_key
  UNIQUE (business_id, customer_id, starts_at);

COMMIT;
