-- A logical transcription segment is unique within its recording session.
-- Fail closed if historical duplicates exist: deployment must stop for an
-- explicit repair rather than silently deleting transcript content.
-- Rollback: ALTER TABLE transcription_segments DROP CONSTRAINT
-- transcription_segments_recording_session_id_segment_index_key;

BEGIN;

DO $$
DECLARE
  duplicate_count bigint;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT recording_session_id, segment_index
    FROM transcription_segments
    GROUP BY recording_session_id, segment_index
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce transcription segment uniqueness: % duplicate session/index groups require explicit repair',
      duplicate_count;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transcription_segments_recording_session_id_segment_index_key'
      AND conrelid = 'transcription_segments'::regclass
  ) THEN
    ALTER TABLE transcription_segments
      ADD CONSTRAINT transcription_segments_recording_session_id_segment_index_key
      UNIQUE (recording_session_id, segment_index);
  END IF;
END $$;

COMMIT;
