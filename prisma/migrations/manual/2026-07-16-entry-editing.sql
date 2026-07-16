-- Entry editing core (the pencil): provenance + versioning + soft-delete on
-- entries, human summary overlay on records, append-only edit audit table.
-- All additive. Apply BEFORE deploying the service code that writes them.

-- Entry provenance
CREATE TYPE "EntryAuthor" AS ENUM ('AI', 'HUMAN_EDITED', 'HUMAN_CREATED');

ALTER TABLE karute_entries
  ADD COLUMN author "EntryAuthor" NOT NULL DEFAULT 'AI',
  ADD COLUMN original_ai_content text,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at timestamptz;

-- Existing manual entries were human-created; everything else is AI.
UPDATE karute_entries SET author = 'HUMAN_CREATED' WHERE is_manual;

-- Human overlay on the AI summary (readers use edited ?? ai)
ALTER TABLE karute_records ADD COLUMN edited_summary text;

-- Append-only audit + correction-pair log
CREATE TYPE "EntryEditAction" AS ENUM
  ('CREATE', 'EDIT', 'DELETE', 'REGEN_REPLACE', 'ADOPT_AI', 'DISMISS_AI');

CREATE TABLE karute_entry_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  karute_record_id uuid NOT NULL, -- no FK: audit survives record deletion
  entry_id_old uuid,
  entry_id_new uuid,
  actor_staff_id uuid,
  action "EntryEditAction" NOT NULL,
  category "EntryCategory",
  content_before text,
  content_after text,
  author_before "EntryAuthor",
  author_after "EntryAuthor",
  batch_id uuid,
  prompt_version text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX karute_entry_edits_business_id_created_at_idx
  ON karute_entry_edits (business_id, created_at);
CREATE INDEX karute_entry_edits_karute_record_id_idx
  ON karute_entry_edits (karute_record_id);
CREATE INDEX karute_entry_edits_batch_id_idx
  ON karute_entry_edits (batch_id);
