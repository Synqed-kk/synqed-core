-- audit_log identity + correlation columns (Liam's A3/A4 asks):
--   actor_staff_ref — the permanent staff CARD id, resolved at write time even
--     when the caller sends a login uuid as actor_id. Durable fix for staff
--     whose card isn't linked to a login: labels collide and detail JSON gets
--     scrubbed on customer deletion, so identity needs a real column.
--   request_id — correlates the rows one action writes.
-- Additive only; append-only trigger unaffected by ADD COLUMN.
-- Rollback: ALTER TABLE audit_log DROP COLUMN actor_staff_ref, DROP COLUMN request_id;
--           DROP INDEX audit_log_business_id_actor_staff_ref_at_idx;

BEGIN;

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS actor_staff_ref uuid,
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE INDEX IF NOT EXISTS audit_log_business_id_actor_staff_ref_at_idx
  ON audit_log (business_id, actor_staff_ref, at);

COMMIT;
