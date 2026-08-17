-- Photo soft delete (Liam 8/16): deletePhoto flips deleted_at instead of
-- destroying; storage file kept; restore endpoint clears it. No purge in v1.
-- Rollback: ALTER TABLE customer_photos DROP COLUMN deleted_at, DROP COLUMN deleted_by;

BEGIN;

ALTER TABLE customer_photos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

COMMIT;
