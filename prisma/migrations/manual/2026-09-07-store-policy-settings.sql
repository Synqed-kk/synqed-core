-- CORE-10: named defaults only; unspecified scalar settings stay NULL.
BEGIN;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS override_roles text[] NOT NULL DEFAULT ARRAY['オーナー','店舗管理者','スタッフ']::text[];
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS override_locked_out text[] NOT NULL DEFAULT '{}';
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS override_hold_to_confirm boolean NOT NULL DEFAULT true;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS override_strict_wall boolean NOT NULL DEFAULT false;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS min_sellable_min integer NOT NULL DEFAULT 30;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS gap_fill_min_min integer;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS held_rank_access text NOT NULL DEFAULT 'closed';
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS release_held_roles text[] NOT NULL DEFAULT ARRAY['オーナー','店舗管理者']::text[];
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS booking_step_min integer NOT NULL DEFAULT 30;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS block_step_min integer NOT NULL DEFAULT 15;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS gap_fill_discount_pct integer;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS lead_time_min integer;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS reserve_start_grid_min integer;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS standard_session_min integer;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS price_lock_during_recalc boolean;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS breaks_paid boolean NOT NULL DEFAULT false;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS special_open_days jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE store_booking_policies DROP CONSTRAINT IF EXISTS sbp_new_client_session_range;
ALTER TABLE store_booking_policies ADD CONSTRAINT sbp_new_client_session_range
  CHECK (new_client_session_minutes BETWEEN 30 AND 240 AND new_client_session_minutes % 15 = 0);
-- Persisted domains also protect direct Prisma/maintenance writers.
ALTER TABLE store_booking_policies DROP CONSTRAINT IF EXISTS sbp_settings_domains;
ALTER TABLE store_booking_policies ADD CONSTRAINT sbp_settings_domains CHECK (
  min_sellable_min BETWEEN 0 AND 1440 AND
  (gap_fill_min_min IS NULL OR gap_fill_min_min BETWEEN 0 AND 1440) AND
  held_rank_access IN ('closed','silver','gold','platinum') AND
  booking_step_min BETWEEN 1 AND 1440 AND block_step_min BETWEEN 1 AND 1440 AND
  (gap_fill_discount_pct IS NULL OR gap_fill_discount_pct BETWEEN 0 AND 30) AND
  (lead_time_min IS NULL OR lead_time_min BETWEEN 0 AND 10080) AND
  (reserve_start_grid_min IS NULL OR reserve_start_grid_min IN (15,30,60)) AND
  (standard_session_min IS NULL OR standard_session_min BETWEEN 1 AND 1440)
);

CREATE OR REPLACE FUNCTION valid_special_open_days(days jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d jsonb; seen text[] := '{}';
BEGIN
  IF jsonb_typeof(days) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(days) > 366 THEN RETURN false; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(days) LOOP
    IF jsonb_typeof(d) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF jsonb_typeof(d->'date') IS DISTINCT FROM 'string' OR
       jsonb_typeof(d->'open') IS DISTINCT FROM 'string' OR
       jsonb_typeof(d->'close') IS DISTINCT FROM 'string' OR
       d - 'date' - 'open' - 'close' <> '{}'::jsonb THEN RETURN false; END IF;
    IF d->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
       d->>'open' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR
       d->>'close' !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' OR
       d->>'open' >= d->>'close' THEN RETURN false; END IF;
    IF to_char((d->>'date')::date, 'YYYY-MM-DD') <> d->>'date' OR
       d->>'date' = ANY(seen) THEN RETURN false; END IF;
    seen := array_append(seen, d->>'date');
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
ALTER TABLE store_booking_policies DROP CONSTRAINT IF EXISTS sbp_special_open_days_domain;
ALTER TABLE store_booking_policies ADD CONSTRAINT sbp_special_open_days_domain
  CHECK (valid_special_open_days(special_open_days));
COMMIT;
