-- Adds invites.invited_staff_id — the existing staff row an invite re-activates,
-- so acceptInvite sets that staff's user_id instead of minting a duplicate (the
-- bug where re-inviting a current person at a new email orphaned their history).
-- Additive + nullable: existing email-only invites keep working (null = new person).

ALTER TABLE invites ADD COLUMN IF NOT EXISTS invited_staff_id uuid;
