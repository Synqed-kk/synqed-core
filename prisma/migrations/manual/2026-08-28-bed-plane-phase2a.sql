-- Bed plane phase 2a (Liam 8/27 items 5 + 7): per-store opening hours +
-- ad-hoc closed days, and staff qualifications + the menu link.
--
-- weekly_hours (jsonb, NULL = not configured): { "mon": {"open":"10:00",
-- "close":"20:00"} | null, ... } — null/absent weekday = 定休日. Ad-hoc
-- closures (臨時休業) are rows in store_closed_days.
--
-- qualifications retire via active:false (house rule: no hard delete — menus
-- reference them). staff_qualifications mirrors staff_stores semantics
-- (replace-the-set).
--
-- Rollback: ALTER TABLE menus DROP COLUMN required_qualification_id;
--   DROP TABLE staff_qualifications; DROP TABLE qualifications;
--   DROP TABLE store_closed_days;
--   ALTER TABLE store_booking_policies DROP COLUMN weekly_hours;

BEGIN;

ALTER TABLE store_booking_policies
  ADD COLUMN IF NOT EXISTS weekly_hours jsonb;

CREATE TABLE IF NOT EXISTS store_closed_days (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  store_id    uuid NOT NULL REFERENCES stores(id),
  date        date NOT NULL,
  reason      text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, date)
);

CREATE TABLE IF NOT EXISTS qualifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS staff_qualifications (
  staff_id         uuid NOT NULL,
  qualification_id uuid NOT NULL REFERENCES qualifications(id) ON DELETE CASCADE,
  business_id      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, qualification_id)
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE store_closed_days     ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_qualifications  ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY business_read_select ON store_closed_days
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY business_read_select ON qualifications
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY business_read_select ON staff_qualifications
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS store_closed_days_business_date_idx
  ON store_closed_days (business_id, date);
CREATE INDEX IF NOT EXISTS qualifications_business_active_idx
  ON qualifications (business_id, active);
CREATE INDEX IF NOT EXISTS staff_qualifications_business_qual_idx
  ON staff_qualifications (business_id, qualification_id);

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS required_qualification_id uuid REFERENCES qualifications(id);

COMMIT;
