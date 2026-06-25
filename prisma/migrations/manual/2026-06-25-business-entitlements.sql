-- BusinessEntitlement — plan tier + comp/dev unlimited override (store cap),
-- consolidated from the karute app DB. One row per business; absent = 'free'.
BEGIN;

CREATE TABLE IF NOT EXISTS business_entitlements (
  business_id  uuid PRIMARY KEY,
  tier         text NOT NULL DEFAULT 'free',
  is_unlimited boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE business_entitlements ENABLE ROW LEVEL SECURITY;

COMMIT;
