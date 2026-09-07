-- CORE-8. Local calendar dates and minute offsets match the Business day board.
-- Apply before deploying the API. Rollback: DROP TABLE staff_shifts (loses shifts).
BEGIN;
CREATE TABLE IF NOT EXISTS staff_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  store_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  date date NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  breaks jsonb NOT NULL DEFAULT '[]',
  blocks jsonb NOT NULL DEFAULT '[]',
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shifts_window CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute),
  CONSTRAINT staff_shifts_arrays CHECK (jsonb_typeof(breaks) = 'array' AND jsonb_typeof(blocks) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_shifts_business_id_staff_id_store_id_date_key
  ON staff_shifts (business_id, staff_id, store_id, date);
CREATE INDEX IF NOT EXISTS staff_shifts_business_id_store_id_date_idx
  ON staff_shifts (business_id, store_id, date);
ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY business_read_select ON staff_shifts FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
