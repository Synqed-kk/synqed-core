-- 監査ログ wave 1 + deletion rulings (Liam 2026-07-17). All additive.
-- Apply BEFORE deploying the service code.

-- ── audit_log ────────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  store_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_type text NOT NULL,
  actor_role text,
  category text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  target_label text,
  detail jsonb,
  break_glass boolean NOT NULL DEFAULT false,
  severity text NOT NULL DEFAULT 'info'
);
-- NO FKs on actor_id/target_id on purpose: inserts never take locks on
-- customers/staff rows; deletes never fight the log. target_id is text so
-- post-scrub hashes fit.

CREATE INDEX audit_log_business_at_idx ON audit_log (business_id, at);
CREATE INDEX audit_log_business_actor_at_idx ON audit_log (business_id, actor_id, at);
CREATE INDEX audit_log_business_target_at_idx ON audit_log (business_id, target_type, target_id, at);
CREATE INDEX audit_log_business_category_at_idx ON audit_log (business_id, category, at);

-- Append-only, enforced in the DB regardless of role: UPDATE/DELETE raise
-- unless the scrub function's session flag is set. (Grants alone can't bind
-- the table owner; the trigger binds everyone.)
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.audit_scrub', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'audit_log is append-only (use audit_log_scrub_customer for erasure)';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- The ONE erasure path: when a customer is fully (hard) deleted, their old
-- audit rows are scrubbed — target_id hashed, label/detail nulled. SECURITY
-- DEFINER + the session flag makes this the only thing that can ever mutate
-- the table.
CREATE OR REPLACE FUNCTION audit_log_scrub_customer(p_business_id uuid, p_customer_id uuid)
RETURNS integer AS $$
DECLARE scrubbed integer;
BEGIN
  PERFORM set_config('app.audit_scrub', 'on', true); -- txn-local
  UPDATE audit_log
     SET target_id = encode(sha256(target_id::bytea), 'hex'),
         target_label = NULL,
         detail = NULL
   WHERE business_id = p_business_id
     AND target_type = 'customer'
     AND target_id = p_customer_id::text;
  GET DIAGNOSTICS scrubbed = ROW_COUNT;
  PERFORM set_config('app.audit_scrub', 'off', true);
  RETURN scrubbed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── customers: 30-day recoverable soft delete ───────────────────────────────
ALTER TABLE customers ADD COLUMN deleted_at timestamptz;
CREATE INDEX customers_business_deleted_idx ON customers (business_id, deleted_at);

-- ── pack_redemptions: undo becomes a soft delete (records WHO undid) ────────
ALTER TABLE pack_redemptions
  ADD COLUMN removed_at timestamptz,
  ADD COLUMN removed_by uuid;
