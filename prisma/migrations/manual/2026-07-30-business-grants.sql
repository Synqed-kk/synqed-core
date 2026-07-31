-- Org-level grants (HQ_ADMIN first): the authz floor under org-wide settings
-- (pricing rules, acceptance policy, messaging templates). Soft-revoke.
-- Rollback: DROP TABLE business_grants; DROP TYPE "BusinessGrantType";

BEGIN;

DO $$ BEGIN
  CREATE TYPE "BusinessGrantType" AS ENUM ('HQ_ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS business_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL,
  staff_id     uuid NOT NULL,
  "grant"      "BusinessGrantType" NOT NULL,
  granted_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  revoked_by   uuid
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE business_grants ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS business_grants_business_id_staff_id_idx
  ON business_grants (business_id, staff_id);
-- One LIVE grant of a type per staff — regrant after revoke stays possible.
CREATE UNIQUE INDEX IF NOT EXISTS business_grants_live_unique
  ON business_grants (business_id, staff_id, "grant")
  WHERE revoked_at IS NULL;

COMMIT;
