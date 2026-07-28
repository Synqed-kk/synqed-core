-- Idempotency-Key dedup store for appointment create (A2 / reserve #28).
-- A retried POST /appointments carrying the same Idempotency-Key must return
-- the appointment the first attempt created instead of double-booking.
--
-- Claim protocol (see idempotency.service.ts):
--   INSERT (claim) -> create appointment -> UPDATE appointment_id (complete).
--   A concurrent duplicate hits the unique key: appointment_id set -> replay;
--   NULL -> first attempt still in flight -> caller retries. A claim whose
--   owner crashed (appointment_id NULL past the stale window) is taken over.
--
-- Rollback: DROP TABLE idempotency_keys;

BEGIN;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL,
  key             text NOT NULL,
  -- No FK: the appointment row may be deleted later; the replay then 404s
  -- naturally rather than blocking the delete.
  appointment_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_business_key_unique UNIQUE (business_id, key)
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

COMMIT;
