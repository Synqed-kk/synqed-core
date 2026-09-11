-- Recording jobs must be able to distinguish deterministic terminal failures
-- from transient failures that may consume the ordinary retry budget.
ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS terminal_reason text;
