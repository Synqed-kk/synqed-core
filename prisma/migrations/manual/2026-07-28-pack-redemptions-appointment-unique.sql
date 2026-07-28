-- One booking can never burn two tickets, even on simultaneous requests —
-- same pattern as 2026-07-06-appointment-active-slot-partial.sql.
-- Precheck before applying: zero duplicate active (appointment_id) pairs
--   SELECT appointment_id, COUNT(*) FROM pack_redemptions
--   WHERE removed_at IS NULL AND appointment_id IS NOT NULL
--   GROUP BY appointment_id HAVING COUNT(*) > 1;
-- (run 2026-07-28: clean). APPLIED to core prod 2026-07-28.
-- App side (karute #628) already handles the block: staff sees "ticket not
-- consumed". Rollback: DROP INDEX pack_redemptions_active_appointment_unique;

CREATE UNIQUE INDEX IF NOT EXISTS pack_redemptions_active_appointment_unique
  ON pack_redemptions (appointment_id)
  WHERE removed_at IS NULL AND appointment_id IS NOT NULL;
