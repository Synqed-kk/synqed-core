-- One row per recording discard (Liam 8/17 correction applied): staff discards
-- REQUIRE a written reason, system cleanup rows carry none; category is
-- exactly staff-vs-system. Written reason is content — audit rows reference
-- this row's id, the text never enters the audit log. No FK to
-- recording_sessions: sessions hard-delete and this ledger must outlive them.
-- Rollback: DROP TABLE recording_discard_events; DROP TYPE "RecordingDiscardSource";

BEGIN;

DO $$ BEGIN
  CREATE TYPE "RecordingDiscardSource" AS ENUM ('STAFF', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS recording_discard_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL,
  recording_session_id  uuid NOT NULL,
  source                "RecordingDiscardSource" NOT NULL,
  discarded_by          uuid,
  reason                text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- Staff discard: written reason mandatory, actor mandatory.
  -- System cleanup: no reason, no actor.
  CONSTRAINT rde_staff_needs_reason CHECK (
    (source = 'STAFF' AND discarded_by IS NOT NULL AND reason IS NOT NULL AND btrim(reason) <> '')
    OR (source = 'SYSTEM' AND discarded_by IS NULL AND reason IS NULL)
  )
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE recording_discard_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS recording_discard_events_session_idx
  ON recording_discard_events (business_id, recording_session_id);
CREATE INDEX IF NOT EXISTS recording_discard_events_created_idx
  ON recording_discard_events (business_id, created_at);

COMMIT;
