-- CORE-12: additive correction metadata. Existing sources/statuses and history
-- remain untouched; ticket_packs.status is already text (now also accepts void).
ALTER TABLE pack_redemptions ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE pack_redemptions ADD COLUMN IF NOT EXISTS removal_source text;
ALTER TABLE pack_redemptions ADD COLUMN IF NOT EXISTS removal_reason text;
