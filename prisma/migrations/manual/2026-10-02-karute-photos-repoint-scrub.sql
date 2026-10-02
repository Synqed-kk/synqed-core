-- CORE-16: customer erasure also scrubs karute.photos_repoint audit rows.
-- Their detail names customers in from_customer_ids (array) and to_customer_id.
-- Same function as 2026-09-07-linked-pack-sharing.sql plus that one clause.
BEGIN;
CREATE OR REPLACE FUNCTION audit_log_scrub_customer(p_business_id uuid, p_customer_id uuid)
RETURNS integer AS $$
DECLARE scrubbed integer;
BEGIN
  PERFORM set_config('app.audit_scrub', 'on', true);
  UPDATE audit_log
     SET target_id = CASE WHEN target_type = 'customer' THEN encode(sha256(target_id::bytea), 'hex') ELSE target_id END,
         target_label = NULL, detail = NULL
   WHERE business_id = p_business_id AND (
     (target_type = 'customer' AND target_id = p_customer_id::text)
     OR (action = 'customer.pack_sharing' AND (
       (detail->'before') ? p_customer_id::text OR (detail->'after') ? p_customer_id::text))
     OR (action IN ('pack.shared_redeem', 'pack.shared_undo') AND (
       detail->>'pack_holder_customer_id' = p_customer_id::text OR detail->>'visitor_customer_id' = p_customer_id::text))
     OR (action = 'karute.photos_repoint' AND (
       (detail->'from_customer_ids') ? p_customer_id::text OR detail->>'to_customer_id' = p_customer_id::text))
   );
  GET DIAGNOSTICS scrubbed = ROW_COUNT;
  PERFORM set_config('app.audit_scrub', 'off', true);
  RETURN scrubbed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMIT;
