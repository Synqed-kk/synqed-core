-- Invite + CustomerMemoryItem, consolidated from the karute app DB.
BEGIN;

CREATE TABLE IF NOT EXISTS invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  email       text NOT NULL,
  role        text NOT NULL,
  token       text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'pending',
  invited_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);
CREATE INDEX IF NOT EXISTS invites_business_id_idx ON invites (business_id);
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS customer_memory_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL,
  customer_id           text NOT NULL,
  category              text NOT NULL,
  label                 text NOT NULL,
  detail                text,
  source                text,
  confidence            real,
  pinned                boolean NOT NULL DEFAULT false,
  suggest_talking_point boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX IF NOT EXISTS customer_memory_items_biz_cust_idx ON customer_memory_items (business_id, customer_id);
ALTER TABLE customer_memory_items ENABLE ROW LEVEL SECURITY;

COMMIT;
