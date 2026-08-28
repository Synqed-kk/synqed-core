-- Booking status history + rebook provenance (Liam msg-8 item 5).
--
-- appointment_status_events = one row per status CHANGE (status, who, source,
-- reason, when) — the event stream the single-slot status_* fields on
-- appointments overwrite. Every writer that changes status appends here in
-- the SAME transaction (API create/update, QR crawl update, orphan-cancel
-- sweep). Restating the current status appends nothing.
--
-- appointments.rebooked_from_appointment_id = the link from a replacement
-- booking back to the booking it replaced ("cancel that got re-booked" vs
-- "lost customer"). SET NULL on delete of the old row.
--
-- History starts at deploy — existing rows get no backfilled events (their
-- current state is still readable from the status_* fields).
--
-- Rollback: ALTER TABLE appointments DROP COLUMN rebooked_from_appointment_id;
--   DROP TABLE appointment_status_events;

BEGIN;

CREATE TABLE IF NOT EXISTS appointment_status_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  status         "AppointmentStatus" NOT NULL,
  status_source  "StatusSource" NOT NULL,
  set_by         uuid,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE appointment_status_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY business_read_select ON appointment_status_events
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS appointment_status_events_appointment_idx
  ON appointment_status_events (appointment_id, created_at);
CREATE INDEX IF NOT EXISTS appointment_status_events_business_idx
  ON appointment_status_events (business_id, created_at);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS rebooked_from_appointment_id uuid
    REFERENCES appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS appointments_rebooked_from_idx
  ON appointments (rebooked_from_appointment_id)
  WHERE rebooked_from_appointment_id IS NOT NULL;

COMMIT;
