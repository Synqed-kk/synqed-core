-- CORE-3: retained audio has one recording; sharing attribution is nullable.
-- Apply before deploying the API. Existing duplicate paths must be resolved
-- deliberately: this migration fails atomically rather than deleting audio
-- or choosing a recording to keep.
-- Preflight:
-- SELECT audio_storage_path, count(*) FROM recording_sessions
-- WHERE audio_storage_path IS NOT NULL
-- GROUP BY audio_storage_path HAVING count(*) > 1;
-- Rollback: drop recording_sessions_audio_storage_path_key, shared_at,
-- and shared_by_staff_id only after rolling back the API.

BEGIN;

ALTER TABLE recording_sessions
  ADD COLUMN IF NOT EXISTS shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS shared_by_staff_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS recording_sessions_audio_storage_path_key
  ON recording_sessions (audio_storage_path);

COMMIT;
