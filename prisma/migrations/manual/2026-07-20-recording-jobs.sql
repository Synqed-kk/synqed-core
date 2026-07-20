-- Server-side recording→karute pipeline state (Liam ask 2026-07-19).
-- UNIQUE(recording_session_id) = the idempotency rail. Additive.

CREATE TYPE "RecordingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE recording_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  recording_session_id uuid NOT NULL UNIQUE,
  status "RecordingJobStatus" NOT NULL DEFAULT 'QUEUED',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  payload jsonb NOT NULL,
  karute_record_id uuid,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recording_jobs_status_created_idx ON recording_jobs (status, created_at);
CREATE INDEX recording_jobs_business_created_idx ON recording_jobs (business_id, created_at);
