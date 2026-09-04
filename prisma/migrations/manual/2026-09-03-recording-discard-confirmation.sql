-- Immutable manager confirmation attribution for recording discard rows.
-- No staff FK: this durable ledger must outlive staff/session deletion.
-- Rollback: drop rde_confirmation_pair, confirmed_at, and confirmed_by.

BEGIN;

ALTER TABLE recording_discard_events
  ADD COLUMN IF NOT EXISTS confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rde_confirmation_pair'
      AND conrelid = 'recording_discard_events'::regclass
  ) THEN
    ALTER TABLE recording_discard_events
      ADD CONSTRAINT rde_confirmation_pair CHECK (
        (confirmed_by IS NULL AND confirmed_at IS NULL)
        OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
      );
  END IF;
END $$;

COMMIT;
