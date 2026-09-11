-- Truthful recording lifecycle and nullable phone facts.
DO $$ BEGIN
  CREATE TYPE "RecordingLifecycleState" AS ENUM
    ('RECORDING', 'UPLOADED', 'FINALIZED', 'QUEUED', 'TRANSCRIBED', 'SAVED', 'FAILED', 'DISCARDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE recording_sessions
  ADD COLUMN IF NOT EXISTS lifecycle_state "RecordingLifecycleState" NOT NULL DEFAULT 'RECORDING',
  ADD COLUMN IF NOT EXISTS client_version text,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS audio_mime text,
  ADD COLUMN IF NOT EXISTS sample_rate_hz integer,
  ADD COLUMN IF NOT EXISTS audio_route text;

-- One-time inference for rows created before the lifecycle column existed.
UPDATE recording_sessions s
   SET lifecycle_state = 'SAVED'
 WHERE EXISTS (SELECT 1 FROM karute_records k WHERE k.recording_session_id = s.id);
UPDATE recording_sessions s
   SET lifecycle_state = 'FAILED'
 WHERE lifecycle_state = 'RECORDING'
   AND EXISTS (
     SELECT 1 FROM recording_jobs j
      WHERE j.recording_session_id = s.id AND j.status = 'FAILED'
   );
UPDATE recording_sessions s
   SET lifecycle_state = 'DISCARDED'
 WHERE lifecycle_state NOT IN ('SAVED', 'FAILED')
   AND EXISTS (
     SELECT 1 FROM recording_discard_events d
      WHERE d.recording_session_id = s.id
   );
UPDATE recording_sessions
   SET lifecycle_state = 'FINALIZED'
 WHERE lifecycle_state = 'RECORDING'
   AND audio_storage_path IS NOT NULL
   AND duration_seconds IS NOT NULL;
UPDATE recording_sessions
   SET lifecycle_state = 'UPLOADED'
 WHERE lifecycle_state = 'RECORDING'
   AND audio_storage_path IS NOT NULL;
