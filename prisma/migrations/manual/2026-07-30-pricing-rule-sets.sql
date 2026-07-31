-- Dynamic-pricing rules: WHEN the price moves inside the menu band (#55 owns
-- the band). Versioned per store × menu; one ACTIVE per scope enforced by a
-- partial unique (COALESCE folds the NULL store-default scope into the key).
-- Rollback: DROP TABLE pricing_rule_sets; DROP TYPE "PricingScopeType"; DROP TYPE "PricingRuleStatus";

BEGIN;

DO $$ BEGIN
  CREATE TYPE "PricingScopeType" AS ENUM ('STORE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PricingRuleStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pricing_rule_sets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL,
  scope_type   "PricingScopeType" NOT NULL DEFAULT 'STORE',
  store_id     uuid NOT NULL,
  menu_id      uuid,
  version      integer NOT NULL,
  status       "PricingRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  rules        jsonb NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE pricing_rule_sets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS pricing_rule_sets_scope_idx
  ON pricing_rule_sets (business_id, store_id, menu_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS pricing_rule_sets_one_active
  ON pricing_rule_sets (business_id, store_id, COALESCE(menu_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ACTIVE';

COMMIT;
