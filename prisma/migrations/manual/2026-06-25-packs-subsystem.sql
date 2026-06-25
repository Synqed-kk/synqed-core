-- 回数券 (ticket-pack) subsystem — consolidated from the karute app DB. All
-- customer-keyed; business_id is the tenant scope. RLS enabled (no policy) to
-- match core posture. The app keeps the usage aggregation.
BEGIN;

CREATE TABLE IF NOT EXISTS ticket_packs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL,
  customer_id    uuid NOT NULL,
  kind           text NOT NULL,
  pack_size      integer NOT NULL,
  unit_price     integer NOT NULL,
  total_price    integer,
  purchase_round integer NOT NULL DEFAULT 0,
  purchased_at   date,
  source         text NOT NULL DEFAULT 'manual',
  status         text NOT NULL,
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_packs_business_customer_idx ON ticket_packs (business_id, customer_id);
CREATE INDEX IF NOT EXISTS ticket_packs_business_status_idx ON ticket_packs (business_id, status);

CREATE TABLE IF NOT EXISTS pack_redemptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL,
  pack_id          uuid NOT NULL,
  customer_id      uuid NOT NULL,
  redeemed_on      date NOT NULL,
  appointment_id   text,
  karute_record_id text,
  source           text NOT NULL DEFAULT 'manual',
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pack_redemptions_business_customer_idx ON pack_redemptions (business_id, customer_id);
CREATE INDEX IF NOT EXISTS pack_redemptions_business_pack_idx ON pack_redemptions (business_id, pack_id);
CREATE INDEX IF NOT EXISTS pack_redemptions_business_redeemed_idx ON pack_redemptions (business_id, redeemed_on);

CREATE TABLE IF NOT EXISTS pack_alert_dismissals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL,
  customer_id  uuid NOT NULL,
  dismissed_by uuid NOT NULL,
  reason       text,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pack_alert_dismissals_business_customer_idx ON pack_alert_dismissals (business_id, customer_id);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL,
  customer_id  uuid NOT NULL,
  channel      text NOT NULL,
  alert_kind   text,
  note         text,
  contacted_by uuid NOT NULL,
  contacted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_contacts_business_customer_idx ON customer_contacts (business_id, customer_id);
CREATE INDEX IF NOT EXISTS customer_contacts_business_contacted_idx ON customer_contacts (business_id, contacted_at);

CREATE TABLE IF NOT EXISTS visit_reconcile_dismissals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL,
  customer_id    uuid NOT NULL,
  appointment_id text,
  visit_day      date NOT NULL,
  dismissed_by   uuid NOT NULL,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visit_reconcile_dismissals_business_customer_idx ON visit_reconcile_dismissals (business_id, customer_id);
CREATE INDEX IF NOT EXISTS visit_reconcile_dismissals_business_day_idx ON visit_reconcile_dismissals (business_id, visit_day);

CREATE TABLE IF NOT EXISTS customer_lifecycle (
  customer_id       uuid PRIMARY KEY,
  business_id       uuid NOT NULL,
  status            text NOT NULL,
  referral          boolean NOT NULL DEFAULT false,
  status_changed_at timestamptz,
  reason            text,
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_lifecycle_business_idx ON customer_lifecycle (business_id);

ALTER TABLE ticket_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_alert_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_reconcile_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_lifecycle ENABLE ROW LEVEL SECURITY;

COMMIT;
