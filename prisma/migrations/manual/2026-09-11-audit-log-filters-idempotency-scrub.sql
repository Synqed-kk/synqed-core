-- Audit filters/idempotency need no table shape change. Extend the existing
-- SECURITY DEFINER erasure function so customer ids embedded in detail JSON
-- are scrubbed without deleting the evidence row.
CREATE OR REPLACE FUNCTION audit_log_scrub_customer(p_business_id uuid, p_customer_id uuid)
RETURNS integer AS $$
DECLARE
  scrubbed integer;
  marker text := encode(sha256(p_customer_id::text::bytea), 'hex');
BEGIN
  PERFORM set_config('app.audit_scrub', 'on', true);
  UPDATE audit_log
     SET target_id = CASE
           WHEN target_type = 'customer' AND target_id = p_customer_id::text
             THEN encode(sha256(target_id::bytea), 'hex')
           ELSE target_id
         END,
         target_label = CASE
           WHEN target_type = 'customer' AND target_id = p_customer_id::text THEN NULL
           ELSE target_label
         END,
         detail = CASE
           WHEN detail IS NULL OR jsonb_typeof(detail) <> 'object' THEN detail
           ELSE jsonb_set(
             jsonb_set(
               jsonb_set(
                 detail,
                 '{customer_id}',
                 CASE WHEN detail->>'customer_id' = p_customer_id::text THEN to_jsonb(marker) ELSE COALESCE(detail->'customer_id', 'null'::jsonb) END,
                 false
               ),
               '{from_customer_id}',
               CASE WHEN detail->>'from_customer_id' = p_customer_id::text THEN to_jsonb(marker) ELSE COALESCE(detail->'from_customer_id', 'null'::jsonb) END,
               false
             ),
             '{to_customer_id}',
             CASE WHEN detail->>'to_customer_id' = p_customer_id::text THEN to_jsonb(marker) ELSE COALESCE(detail->'to_customer_id', 'null'::jsonb) END,
             false
           )
         END
   WHERE business_id = p_business_id
     AND (
       (target_type = 'customer' AND target_id = p_customer_id::text)
       OR (
         jsonb_typeof(detail) = 'object'
         AND (
           detail->>'customer_id' = p_customer_id::text
           OR detail->>'from_customer_id' = p_customer_id::text
           OR detail->>'to_customer_id' = p_customer_id::text
         )
       )
     );
  GET DIAGNOSTICS scrubbed = ROW_COUNT;
  PERFORM set_config('app.audit_scrub', 'off', true);
  RETURN scrubbed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
