-- actor_label: write-time snapshot of the acting staff member's display name
-- (like target_label) — history survives staff deletion instead of showing 不明.
-- Deliberately NO foreign key. Additive; apply before deploying.

ALTER TABLE audit_log ADD COLUMN actor_label text;

-- Backfill from current staff names while they still resolve. actor_id may be
-- a synqed staff id or an auth user uuid (staff.user_id) — match either.
-- Trigger note: audit_log is append-only via audit_log_block_mutation; run the
-- backfill under the scrub flag (same txn-local mechanism the erasure uses).
DO $$
BEGIN
  PERFORM set_config('app.audit_scrub', 'on', true);
  UPDATE audit_log a
     SET actor_label = s.name
    FROM staff s
   WHERE a.actor_label IS NULL
     AND a.actor_id IS NOT NULL
     AND s.business_id = a.business_id
     AND (s.id = a.actor_id OR s.user_id = a.actor_id);
  PERFORM set_config('app.audit_scrub', 'off', true);
END $$;
