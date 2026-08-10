-- Post-session outcomes phase 2 (Liam 8/7): decision_context records which
-- question set was answered (conversion vs repurchase); list index backs the
-- pending-auto-close cron's query. Additive only.
-- NOTE: outcome stays plain text by design — 'revisit' needs no schema work.
-- Rollback: ALTER TABLE karute_outcomes DROP COLUMN decision_context;
--           DROP INDEX karute_outcomes_business_id_outcome_updated_at_idx;

BEGIN;

ALTER TABLE karute_outcomes
  ADD COLUMN IF NOT EXISTS decision_context text;

CREATE INDEX IF NOT EXISTS karute_outcomes_business_id_outcome_updated_at_idx
  ON karute_outcomes (business_id, outcome, updated_at);

COMMIT;
