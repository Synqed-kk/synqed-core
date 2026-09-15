-- CORE-14/15: staff annotations never belong in member/public DTOs.
BEGIN;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS staff_badges text[] NOT NULL DEFAULT '{}';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS requires_private_room boolean NOT NULL DEFAULT false;
ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS staff_badge_definitions jsonb NOT NULL DEFAULT '[{"name":"個室希望","colour":"#2563eb","display_order":0},{"name":"要注意","colour":"#dc2626","display_order":1}]'::jsonb;
COMMIT;
