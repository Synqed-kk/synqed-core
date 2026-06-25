-- StaffStore — many-to-many staff↔store (multi-store), consolidated from the
-- karute app DB's profile_stores, re-keyed on core staff ids. Zero rows for a
-- staff = "works in every store".
BEGIN;

CREATE TABLE IF NOT EXISTS staff_stores (
  staff_id    uuid NOT NULL,
  store_id    uuid NOT NULL,
  business_id uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, store_id)
);

CREATE INDEX IF NOT EXISTS staff_stores_business_store_idx ON staff_stores (business_id, store_id);

ALTER TABLE staff_stores ENABLE ROW LEVEL SECURITY;

COMMIT;
