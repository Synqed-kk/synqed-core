-- Store — physical location (multi-store), consolidated from the karute app DB
-- into core so stores live next to the events (#16 store_id) that key on them.
-- Additive: the karute Supabase `stores` table stays until the app is repointed.
BEGIN;

CREATE TABLE IF NOT EXISTS stores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name        text NOT NULL,
  address     text,
  phone       text,
  is_primary  boolean NOT NULL DEFAULT false,  -- the 本店; exactly one per business
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stores_business_id_idx ON stores (business_id);

-- At most one primary store per business.
CREATE UNIQUE INDEX IF NOT EXISTS stores_one_primary_per_business
  ON stores (business_id) WHERE is_primary;

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

COMMIT;
