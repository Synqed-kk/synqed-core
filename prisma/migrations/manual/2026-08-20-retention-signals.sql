-- Retention-signal store (CORE-ASK-2026-08-16): neutral naming by legal
-- ruling; HARD deletes deliberate (dismissal/expiry/statutory demand erase
-- content; app audit events keep the fact). Customer FK CASCADE = scrub
-- inclusion. Anonymized dismissal counters carry NO personal ids, NO quote.
-- Rollback: DROP TABLE retention_signal_dismissals; DROP TABLE retention_signals;
--           DROP TYPE "RetentionSignalStatus";

BEGIN;

DO $$ BEGIN
  CREATE TYPE "RetentionSignalStatus" AS ENUM ('pending', 'confirmed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS retention_signals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL,
  status             "RetentionSignalStatus" NOT NULL DEFAULT 'pending',
  occurred_at        timestamptz NOT NULL,
  karute_record_id   uuid NOT NULL,
  customer_id        uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  staff_id           uuid NOT NULL,
  criterion          text NOT NULL CHECK (criterion IN ('A','B','C')),
  confidence         text NOT NULL CHECK (confidence IN ('high','medium')),
  quote              text NOT NULL CHECK (btrim(quote) <> ''),
  mentioned_business text,
  confirmed_by       uuid,
  confirmed_at       timestamptz,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retention_signal_dismissals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL,
  criterion    text NOT NULL,
  confidence   text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now()
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE retention_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_signal_dismissals ENABLE ROW LEVEL SECURITY;
-- business_read (8/19 role) gets its usual SELECT policy ONLY on the counters:
-- analysis jobs have no business reading possibly-wrong inferences about
-- named customers.
DO $$ BEGIN
  CREATE POLICY business_read_select ON retention_signal_dismissals
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS retention_signals_expiry_idx
  ON retention_signals (business_id, status, expires_at);
CREATE INDEX IF NOT EXISTS retention_signals_created_idx
  ON retention_signals (business_id, created_at);
CREATE INDEX IF NOT EXISTS retention_signal_dismissals_idx
  ON retention_signal_dismissals (business_id, dismissed_at);

COMMIT;
