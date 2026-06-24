-- Task 11: add the karute LOCATION (uuid) a QR sync config feeds. Synced events
-- (appointments/visits) get stamped with this so they carry the store. Distinct
-- from the existing numeric store_id (the QR API's store id) — that is untouched.
BEGIN;
ALTER TABLE sync_configs ADD COLUMN IF NOT EXISTS karute_store_id uuid;
COMMIT;
