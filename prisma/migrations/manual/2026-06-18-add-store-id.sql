-- Multi-store: tag the EVENT tables with a nullable store_id (uuid) = the karute
-- location. NOT added to `customers` — customer identity is business-wide (one
-- karute number per person); a person's store association is derived from their
-- events. store_id is a plain uuid (no FK; the `stores` table lives in karute).

BEGIN;
ALTER TABLE appointments       ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE customer_visits    ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE karute_records     ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE recording_sessions ADD COLUMN IF NOT EXISTS store_id uuid;

CREATE INDEX IF NOT EXISTS appointments_business_store_idx       ON appointments (business_id, store_id);
CREATE INDEX IF NOT EXISTS customer_visits_business_store_idx    ON customer_visits (business_id, store_id);
CREATE INDEX IF NOT EXISTS karute_records_business_store_idx     ON karute_records (business_id, store_id);
CREATE INDEX IF NOT EXISTS recording_sessions_business_store_idx ON recording_sessions (business_id, store_id);
COMMIT;
