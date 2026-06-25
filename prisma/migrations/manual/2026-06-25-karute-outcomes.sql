-- KaruteOutcome — per-session coaching outcome label, consolidated from the
-- karute app DB. One row per karute record (the app upserts on karute_record_id).
BEGIN;

CREATE TABLE IF NOT EXISTS karute_outcomes (
  karute_record_id uuid PRIMARY KEY,
  business_id      uuid NOT NULL,
  customer_id      uuid,
  outcome          text NOT NULL,
  reason           text,
  is_first_visit   boolean NOT NULL DEFAULT false,
  decided_by       uuid,
  decided_at       timestamptz,
  auto_decided     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS karute_outcomes_business_id_idx ON karute_outcomes (business_id);

ALTER TABLE karute_outcomes ENABLE ROW LEVEL SECURITY;

COMMIT;
