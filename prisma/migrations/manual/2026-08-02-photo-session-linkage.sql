-- Photo-session linkage (Liam spec 2026-08-02): photos taken during sessions
-- carry session/staff/consent. All additive+nullable; existing clients and
-- rows untouched. Plus: idempotency_keys generalized (scope + target_id) so
-- the photo-upload endpoint gets the same retry dedup appointments have.
-- Rollback: ALTER TABLE customer_photos DROP COLUMN recording_session_id,
--   DROP COLUMN captured_by_staff_id, DROP COLUMN taken_with_consent;
--   ALTER TABLE idempotency_keys RENAME COLUMN target_id TO appointment_id,
--   DROP COLUMN scope; recreate unique (business_id, key).

BEGIN;

ALTER TABLE customer_photos
  ADD COLUMN IF NOT EXISTS recording_session_id uuid REFERENCES recording_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS captured_by_staff_id uuid,
  ADD COLUMN IF NOT EXISTS taken_with_consent boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS customer_photos_recording_session_id_idx
  ON customer_photos (recording_session_id);

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'appointment';
DO $$ BEGIN
  ALTER TABLE idempotency_keys RENAME COLUMN appointment_id TO target_id;
EXCEPTION WHEN undefined_column THEN NULL; END $$;
ALTER TABLE idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_business_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_business_scope_key_unique
  ON idempotency_keys (business_id, scope, key);

COMMIT;
