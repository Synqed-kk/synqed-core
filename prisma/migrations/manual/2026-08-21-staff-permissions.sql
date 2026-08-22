-- One core-owned permission system (msg-7 item 1): per-staff assignment rows
-- + the per-business answer-sheet version counter. The rulebook itself is
-- code (permission-rulebook.ts, RULEBOOK_VERSION) served via
-- GET /permissions/rulebook. Additive only; absent rows = coarse-label
-- fallback, so applying this changes nothing until Business writes roles.
-- Rollback: DROP TABLE staff_permissions; DROP TABLE permission_versions;

BEGIN;

CREATE TABLE IF NOT EXISTS staff_permissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL,
  staff_id           uuid NOT NULL UNIQUE,
  role               text NOT NULL CHECK (role IN
    ('owner','manager','senior','practitioner','frontdesk','custom',
     'area_manager','trainee','accountant')),
  overrides          text[] NOT NULL DEFAULT '{}',
  has_overrides      boolean NOT NULL DEFAULT false,
  assigned_store_ids uuid[] NOT NULL DEFAULT '{}',
  updated_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permission_versions (
  business_id uuid PRIMARY KEY,
  version     integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE staff_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_versions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY business_read_select ON staff_permissions
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY business_read_select ON permission_versions
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS staff_permissions_business_idx
  ON staff_permissions (business_id);

COMMIT;
