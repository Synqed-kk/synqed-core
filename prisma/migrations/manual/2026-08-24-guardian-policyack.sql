-- msg-7 item 3 (guardian/payer on customers) + msg-8 item 11 (per-staff
-- recording-policy ledger). Additive only.
-- Rollback: ALTER TABLE customers DROP COLUMN guardian_customer_id, DROP COLUMN payer_note;
--           DROP TABLE staff_policy_events;

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS guardian_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payer_note text;

CREATE INDEX IF NOT EXISTS customers_guardian_idx
  ON customers (guardian_customer_id) WHERE guardian_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_policy_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL,
  staff_id       uuid NOT NULL,
  policy_line    text NOT NULL,
  policy_version integer NOT NULL,
  event          text NOT NULL CHECK (event IN ('delivered','acknowledged','revoked')),
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff_policy_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY business_read_select ON staff_policy_events
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS staff_policy_events_staff_idx
  ON staff_policy_events (business_id, staff_id, policy_line, policy_version);
CREATE INDEX IF NOT EXISTS staff_policy_events_line_idx
  ON staff_policy_events (business_id, policy_line, policy_version, event);

COMMIT;
