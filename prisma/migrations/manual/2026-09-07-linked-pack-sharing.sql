-- CORE-6: tenant-scoped membership and immutable holder/visitor attribution.
BEGIN;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pack_sharing_group_id uuid;
CREATE INDEX IF NOT EXISTS customers_business_pack_sharing_idx ON customers (business_id, pack_sharing_group_id);
ALTER TABLE pack_redemptions ADD COLUMN IF NOT EXISTS pack_holder_customer_id uuid;
UPDATE pack_redemptions r SET pack_holder_customer_id = p.customer_id
FROM ticket_packs p WHERE r.pack_id = p.id AND r.business_id = p.business_id AND r.pack_holder_customer_id IS NULL;
-- Preserve the existing controlled erasure route, extending it to family references.
CREATE OR REPLACE FUNCTION audit_log_scrub_customer(p_business_id uuid, p_customer_id uuid)
RETURNS integer AS $$
DECLARE scrubbed integer;
BEGIN
  PERFORM set_config('app.audit_scrub', 'on', true);
  UPDATE audit_log
     SET target_id = encode(sha256(target_id::bytea), 'hex'), target_label = NULL, detail = NULL
   WHERE business_id = p_business_id AND (
     (target_type = 'customer' AND target_id = p_customer_id::text)
     OR (action = 'customer.pack_sharing' AND (
       (detail->'before') ? p_customer_id::text OR (detail->'after') ? p_customer_id::text))
     OR (action IN ('pack.shared_redeem', 'pack.shared_undo') AND (
       detail->>'pack_holder_customer_id' = p_customer_id::text OR detail->>'visitor_customer_id' = p_customer_id::text))
   );
  GET DIAGNOSTICS scrubbed = ROW_COUNT;
  PERFORM set_config('app.audit_scrub', 'off', true);
  RETURN scrubbed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMIT;
