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
COMMIT;
