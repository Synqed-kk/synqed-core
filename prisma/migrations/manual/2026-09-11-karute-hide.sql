-- Karute records are retained when hidden. The owner can inspect the row and
-- its history; ordinary reads continue to omit hidden records.
ALTER TABLE karute_records
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by uuid,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

CREATE INDEX IF NOT EXISTS karute_records_business_hidden_idx
  ON karute_records (business_id, hidden_at);
