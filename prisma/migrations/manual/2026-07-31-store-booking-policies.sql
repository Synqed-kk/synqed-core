-- Per-store booking-acceptance policy (open horizon / cutoff / cancellation
-- terms) — previously hardcoded in the reserve app. Absent row = defaults.
-- Rollback: DROP TABLE store_booking_policies;

BEGIN;

CREATE TABLE IF NOT EXISTS store_booking_policies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid NOT NULL,
  store_id                 uuid NOT NULL UNIQUE,
  booking_open_days        integer NOT NULL DEFAULT 30,
  cutoff_minutes           integer NOT NULL DEFAULT 0,
  cancel_free_until_hours  integer NOT NULL DEFAULT 24,
  cancel_late_pct          integer NOT NULL DEFAULT 0,
  no_show_pct              integer NOT NULL DEFAULT 0,
  updated_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sbp_open_days_range CHECK (booking_open_days BETWEEN 1 AND 365),
  CONSTRAINT sbp_cutoff_range CHECK (cutoff_minutes BETWEEN 0 AND 10080),
  CONSTRAINT sbp_free_hours_range CHECK (cancel_free_until_hours BETWEEN 0 AND 720),
  CONSTRAINT sbp_late_pct_range CHECK (cancel_late_pct BETWEEN 0 AND 100),
  CONSTRAINT sbp_noshow_pct_range CHECK (no_show_pct BETWEEN 0 AND 100)
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE store_booking_policies ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS store_booking_policies_business_idx
  ON store_booking_policies (business_id);

COMMIT;
