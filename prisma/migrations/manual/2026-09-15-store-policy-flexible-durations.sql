-- CORE-10 follow-up: stores choose minute durations; role keys match the rulebook.
-- Apply after 2026-09-07-store-policy-settings.sql, before deploying this API.
BEGIN;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS sell_slot_min integer NOT NULL DEFAULT 60;
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS auto_release_before text NOT NULL DEFAULT 'linked';
ALTER TABLE store_booking_policies ADD COLUMN IF NOT EXISTS calendar_tight_max integer NOT NULL DEFAULT 2;

ALTER TABLE store_booking_policies DROP CONSTRAINT IF EXISTS sbp_new_client_session_range;
ALTER TABLE store_booking_policies ADD CONSTRAINT sbp_new_client_session_range CHECK (new_client_session_minutes > 0);
ALTER TABLE store_booking_policies DROP CONSTRAINT IF EXISTS sbp_settings_domains;
ALTER TABLE store_booking_policies ADD CONSTRAINT sbp_settings_domains CHECK (
  min_sellable_min >= 0 AND
  (gap_fill_min_min IS NULL OR gap_fill_min_min >= 0) AND
  held_rank_access IN ('closed','silver','gold','platinum') AND
  booking_step_min > 0 AND block_step_min > 0 AND
  (gap_fill_discount_pct IS NULL OR gap_fill_discount_pct BETWEEN 0 AND 30) AND
  (lead_time_min IS NULL OR lead_time_min >= 0) AND
  (reserve_start_grid_min IS NULL OR reserve_start_grid_min > 0) AND
  (standard_session_min IS NULL OR standard_session_min > 0)
);
ALTER TABLE store_booking_policies DROP CONSTRAINT IF EXISTS sbp_selling_calendar_domains;
ALTER TABLE store_booking_policies ADD CONSTRAINT sbp_selling_calendar_domains CHECK (
  sell_slot_min > 0 AND calendar_tight_max BETWEEN 0 AND 5 AND
  (auto_release_before IN ('linked','never') OR auto_release_before ~ '^[1-9][0-9]*$')
);

-- Convert only the three display labels used by the original defaults. Other
-- unknown labels intentionally fail the role CHECK instead of guessing a role.
UPDATE store_booking_policies SET
  override_roles = ARRAY(SELECT CASE role
    WHEN 'オーナー' THEN 'owner' WHEN '店舗管理者' THEN 'manager' WHEN 'スタッフ' THEN 'practitioner'
    ELSE role END FROM unnest(override_roles) AS role),
  release_held_roles = ARRAY(SELECT CASE role
    WHEN 'オーナー' THEN 'owner' WHEN '店舗管理者' THEN 'manager' WHEN 'スタッフ' THEN 'practitioner'
    ELSE role END FROM unnest(release_held_roles) AS role)
WHERE override_roles && ARRAY['オーナー','店舗管理者','スタッフ']::text[]
   OR release_held_roles && ARRAY['オーナー','店舗管理者','スタッフ']::text[];
ALTER TABLE store_booking_policies ALTER COLUMN override_roles SET DEFAULT ARRAY['owner','manager','practitioner']::text[];
ALTER TABLE store_booking_policies ALTER COLUMN release_held_roles SET DEFAULT ARRAY['owner','manager']::text[];
ALTER TABLE store_booking_policies DROP CONSTRAINT IF EXISTS sbp_role_keys;
ALTER TABLE store_booking_policies ADD CONSTRAINT sbp_role_keys CHECK (
  override_roles <@ ARRAY['owner','manager','senior','practitioner','frontdesk','custom','area_manager','trainee','accountant']::text[] AND
  release_held_roles <@ ARRAY['owner','manager','senior','practitioner','frontdesk','custom','area_manager','trainee','accountant']::text[] AND
  array_position(override_roles, NULL) IS NULL AND array_position(release_held_roles, NULL) IS NULL
);
COMMIT;
