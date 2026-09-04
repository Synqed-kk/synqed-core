-- A discard can precede recording-session creation. Keep the durable ledger
-- addressable by either its session or its karute record; at least one is
-- required, and both are allowed.
-- Rollback: drop rde_has_subject and the karute index/column, then restore
-- recording_session_id NOT NULL after removing any karute-only rows.

BEGIN;

ALTER TABLE recording_discard_events
  ADD COLUMN IF NOT EXISTS karute_record_id uuid;

ALTER TABLE recording_discard_events
  ALTER COLUMN recording_session_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE recording_discard_events
    ADD CONSTRAINT rde_has_subject CHECK (
      recording_session_id IS NOT NULL OR karute_record_id IS NOT NULL
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS recording_discard_events_karute_idx
  ON recording_discard_events (business_id, karute_record_id);

COMMIT;
