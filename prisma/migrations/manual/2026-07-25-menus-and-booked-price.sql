-- Menus + booked-price snapshot (SYNQED Reserve real-menu unlock).
--
-- 1. `menus` — the bookable service catalog. Serves the Reserve customer
--    contract (MenuPublic) and the band pricing engine:
--      price_list_amount = the 税込 list price (band ceiling / display baseline)
--      price_min_amount  = the band floor; NULL = fixed price, no discounting
--    Money = integer amount + explicit currency column (no yen hardcode).
--    Menus are retired via `active`, never hard-deleted (appointments
--    reference them as snapshots).
--
-- 2. appointments gains the booked-menu snapshot: menu_id (soft reference,
--    deliberately NO foreign key — menu edits must never rewrite what an
--    existing booking promised) + booked_price_amount/currency = the price
--    the customer agreed to at write time. Backfilling old rows is neither
--    possible nor attempted (their prices were never persisted anywhere).
--
-- Rollback: DROP TABLE menus; ALTER TABLE appointments DROP COLUMN menu_id,
-- DROP COLUMN booked_price_amount, DROP COLUMN booked_price_currency;

BEGIN;

CREATE TABLE IF NOT EXISTS menus (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid NOT NULL,
  store_id                uuid,
  name                    text NOT NULL,
  description             text,
  category                text,
  category_display_order  integer NOT NULL DEFAULT 0,
  display_order           integer NOT NULL DEFAULT 0,
  duration_minutes        integer NOT NULL,
  price_list_amount       integer NOT NULL,
  price_min_amount        integer,
  currency                text NOT NULL DEFAULT 'JPY',
  tax_included            boolean NOT NULL DEFAULT true,
  nomination_allowed      boolean NOT NULL DEFAULT true,
  online_visible          boolean NOT NULL DEFAULT true,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menus_price_list_nonneg CHECK (price_list_amount >= 0),
  CONSTRAINT menus_price_min_valid CHECK (
    price_min_amount IS NULL
    OR (price_min_amount >= 0 AND price_min_amount <= price_list_amount)
  ),
  CONSTRAINT menus_duration_positive CHECK (duration_minutes > 0)
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS menus_business_id_active_idx ON menus (business_id, active);
CREATE INDEX IF NOT EXISTS menus_business_id_store_id_idx ON menus (business_id, store_id);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS menu_id uuid,
  ADD COLUMN IF NOT EXISTS booked_price_amount integer,
  ADD COLUMN IF NOT EXISTS booked_price_currency text;

COMMIT;
