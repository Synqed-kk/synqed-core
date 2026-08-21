-- スキマガード Phase 1 (HANDOFF-2026-08-13): the two policy fields only.
-- NOTHING enforces — the ported engine has no callers; OFF = not invoked.
-- Lead time deliberately reuses cutoff_minutes (no duplicate field).
-- Rollback: ALTER TABLE store_booking_policies DROP COLUMN gap_guard_mode,
--           DROP COLUMN new_client_session_minutes; DROP TYPE "GapGuardMode";

BEGIN;

DO $$ BEGIN
  CREATE TYPE "GapGuardMode" AS ENUM ('OFF', 'STANDARD', 'STRICT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE store_booking_policies
  ADD COLUMN IF NOT EXISTS gap_guard_mode "GapGuardMode" NOT NULL DEFAULT 'OFF',
  ADD COLUMN IF NOT EXISTS new_client_session_minutes integer NOT NULL DEFAULT 90;

ALTER TABLE store_booking_policies
  DROP CONSTRAINT IF EXISTS sbp_new_client_session_range;
ALTER TABLE store_booking_policies
  ADD CONSTRAINT sbp_new_client_session_range
  CHECK (new_client_session_minutes IN (60, 75, 90));

COMMIT;
