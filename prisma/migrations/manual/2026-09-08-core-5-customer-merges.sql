-- CORE-5: exact repairs authorized by Liam in comment
-- 6231e875-4412-4384-984f-b9261320140a. Apply with psql ON_ERROR_STOP=1.
-- Not applied to production by committing this file. Requires maintenance
-- window / weekly ticket-sync holds. Every precondition is checked under locks.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE customers, appointments, ticket_packs, pack_redemptions,
  customer_visits, recording_sessions, karute_records, karute_outcomes,
  customer_photos, recording_consents, customer_memory_items, karute_entry_edits,
  customer_contacts, customer_lifecycle, pack_alert_dismissals,
  visit_reconcile_dismissals, retention_signals IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE core5_pairs (
  keep_id uuid PRIMARY KEY, fold_id uuid UNIQUE NOT NULL,
  keep_number int NOT NULL, fold_number int NOT NULL
) ON COMMIT DROP;
INSERT INTO core5_pairs VALUES
('52c38e11-50ca-42ce-bb62-6f90106a4ee1','77f91da2-eb58-4098-8ad0-48eb1af7db63',542,297),
('f5b1935f-11c4-42f3-86c1-40fab956d043','d9fd622b-f0f6-44ae-89d6-943348b164b0',499,303),
('1a612ecf-6680-4ed1-a1b1-73f688eb1c5b','3608aa06-97bf-41c5-955f-e7bf20941c61',565,322),
('068ab6af-73df-4578-a87f-b34680f6f8bd','d79d0867-e799-44f8-b40a-aba5f8f9707a',492,520),
('ddbf7811-5123-4244-9b39-6f21d9d9bb47','cc70b783-37a1-4f77-bf73-e43deac470e6',429,312),
('4ac94358-30ad-4b60-a526-0c462131d233','fbfe126d-8320-4229-8e1d-4cfb973cd19e',108,313),
('913b55f2-dd1c-469f-84fd-06580de4d914','58c7d18a-94f1-41eb-86b9-57274975475c',82,302);
CREATE TEMP TABLE core5_packs (
  id uuid PRIMARY KEY, original_customer uuid NOT NULL,
  size int NOT NULL, burns int NOT NULL
) ON COMMIT DROP;
INSERT INTO core5_packs VALUES
('1a6033cb-24fb-4fbd-9979-24f7f1782515','77f91da2-eb58-4098-8ad0-48eb1af7db63',6,4),
('42139ad8-0a5c-43ad-94e5-2b11d67cc1f7','d9fd622b-f0f6-44ae-89d6-943348b164b0',10,3),
('b4babe66-453f-4b7d-8c6a-e432674ad3da','3608aa06-97bf-41c5-955f-e7bf20941c61',6,5),
('e0bbeef7-0820-49f6-9f6f-aae7de88670d','1a612ecf-6680-4ed1-a1b1-73f688eb1c5b',6,1),
('073b1aef-771c-43f6-9d44-4c397db51238','cc70b783-37a1-4f77-bf73-e43deac470e6',10,5),
('9b35d65a-e139-4a53-8aaa-8b95e63645e3','fbfe126d-8320-4229-8e1d-4cfb973cd19e',20,7),
('a1fbdaa3-af9b-4aff-911d-5aa90756e606','58c7d18a-94f1-41eb-86b9-57274975475c',10,8),
('87c9cb75-5740-473f-86cc-ca6fbe66d9a3','913b55f2-dd1c-469f-84fd-06580de4d914',6,5),
('f9e96c87-539a-44fe-8612-3fa07cde3360','1f92d3b9-dbe8-41a9-a4dd-74f58e0486bf',6,6);

DO $$
DECLARE
  biz constant uuid := '7bb76aac-2947-47fb-b883-d85fe849ccec';
  migration constant text := '2026-09-08-core-5-customer-merges';
  pair record;
  col record;
  rel text;
  affected int;
  counts jsonb;
  keep_row customers%ROWTYPE;
  fold_row customers%ROWTYPE;
  expected_owner uuid;
  expected_pack record;
  found_pack ticket_packs%ROWTYPE;
  bad boolean;
  regular_tables text[] := ARRAY['appointments','ticket_packs','pack_redemptions',
    'customer_visits','recording_sessions','karute_records','karute_outcomes',
    'customer_photos','recording_consents','customer_memory_items','karute_entry_edits',
    'customer_contacts','pack_alert_dismissals','visit_reconcile_dismissals','retention_signals'];
BEGIN
  -- All fixed UUIDs, chart numbers and business fences must match. A rerun is
  -- permitted only for a twin already folded by this exact migration.
  FOR pair IN SELECT * FROM core5_pairs ORDER BY keep_id LOOP
    SELECT * INTO STRICT keep_row FROM customers WHERE id=pair.keep_id AND business_id=biz;
    SELECT * INTO STRICT fold_row FROM customers WHERE id=pair.fold_id AND business_id=biz;
    IF keep_row.karute_number IS DISTINCT FROM pair.keep_number
      OR fold_row.karute_number IS DISTINCT FROM pair.fold_number
      OR keep_row.deleted_at IS NOT NULL
      OR keep_row.member_number IS NOT NULL OR fold_row.member_number IS NOT NULL
      OR (fold_row.deleted_at IS NOT NULL AND
          fold_row.external_refs->'core5_merge'->>'migration' IS DISTINCT FROM migration)
      OR (fold_row.external_refs ? 'core5_merge' AND
          fold_row.external_refs->'core5_merge'->>'keep_customer_id' IS DISTINCT FROM pair.keep_id::text)
    THEN RAISE EXCEPTION 'CORE5 customer precondition failed: %', pair.fold_id; END IF;
    IF fold_row.deleted_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM audit_log WHERE business_id=biz AND action='merge_duplicate'
        AND target_id=pair.keep_id::text AND detail->>'migration'=migration
        AND detail->>'fold_customer_id'=pair.fold_id::text
    ) THEN RAISE EXCEPTION 'CORE5 missing completed-merge audit: %',pair.fold_id; END IF;
    IF EXISTS(SELECT 1 FROM customer_lifecycle
      WHERE customer_id IN (pair.keep_id,pair.fold_id) AND business_id<>biz)
    THEN RAISE EXCEPTION 'CORE5 cross-business lifecycle: %',pair.fold_id; END IF;
    IF keep_row.guardian_customer_id IS NOT NULL OR fold_row.guardian_customer_id IS NOT NULL
      OR EXISTS(SELECT 1 FROM customers WHERE guardian_customer_id IN (pair.keep_id,pair.fold_id))
    THEN RAISE EXCEPTION 'CORE5 guardian relationship needs explicit reconciliation: %', pair.fold_id; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(fold_row.external_refs) e
      WHERE e.key <> 'core5_merge' AND keep_row.external_refs ? e.key
        AND keep_row.external_refs->e.key IS DISTINCT FROM e.value)
    THEN RAISE EXCEPTION 'CORE5 external reference conflict: %', pair.fold_id; END IF;
  END LOOP;

  -- Inventory schema additions instead of silently leaving new family/member
  -- references behind. Known singleton lifecycle rows are reconciled below.
  FOR col IN SELECT DISTINCT table_name,column_name FROM (
    SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name IN
        ('customer_id','visitor_customer_id','pack_holder_customer_id','guardian_customer_id')
    UNION
    SELECT c.relname,a.attname FROM pg_constraint fk
      JOIN pg_class c ON c.oid=fk.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(fk.conkey)
      WHERE fk.contype='f' AND fk.confrelid='customers'::regclass AND n.nspname='public'
    ) dependencies WHERE true
      AND NOT (column_name='customer_id' AND table_name=ANY(regular_tables || ARRAY['customer_lifecycle']))
      AND NOT (table_name='customers' AND column_name='guardian_customer_id')
  LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', col.table_name);
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I::text IN (SELECT fold_id::text FROM core5_pairs))', col.table_name,col.column_name) INTO bad;
    IF bad THEN RAISE EXCEPTION 'CORE5 unmapped dependency %.% requires reconciliation', col.table_name,col.column_name; END IF;
  END LOOP;
  -- Money preconditions: preserve both packs on the two double-pack pairs.
  FOR expected_pack IN SELECT * FROM core5_packs LOOP
    SELECT * INTO STRICT found_pack FROM ticket_packs WHERE id=expected_pack.id AND business_id=biz;
    SELECT COALESCE((SELECT keep_id FROM core5_pairs WHERE fold_id=expected_pack.original_customer),expected_pack.original_customer) INTO expected_owner;
    IF found_pack.customer_id NOT IN (expected_pack.original_customer,expected_owner)
      OR found_pack.pack_size <> expected_pack.size
      OR (SELECT count(*) FROM pack_redemptions WHERE pack_id=expected_pack.id AND removed_at IS NULL) <> expected_pack.burns
      OR EXISTS(SELECT 1 FROM pack_redemptions WHERE pack_id=expected_pack.id AND (business_id<>biz OR customer_id<>found_pack.customer_id))
    THEN RAISE EXCEPTION 'CORE5 pack/burn precondition failed: %', expected_pack.id; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM ticket_packs WHERE customer_id IN
    (SELECT keep_id FROM core5_pairs UNION ALL SELECT fold_id FROM core5_pairs)
    AND id NOT IN (SELECT id FROM core5_packs))
  THEN RAISE EXCEPTION 'CORE5 unexpected pack: refresh the live preflight'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pack_redemptions
    WHERE id='a779da15-2dbd-4262-8c98-5972ddf0310f'
      AND business_id=biz AND customer_id='1f92d3b9-dbe8-41a9-a4dd-74f58e0486bf'
      AND pack_id='f9e96c87-539a-44fe-8612-3fa07cde3360' AND removed_at IS NULL
      AND redeemed_on IN (DATE '2026-12-25', DATE '2025-12-25'))
    OR NOT EXISTS(SELECT 1 FROM ticket_packs WHERE id='f9e96c87-539a-44fe-8612-3fa07cde3360'
      AND purchased_at IN (DATE '2026-12-25',DATE '2025-12-25') AND status IN ('active','exhausted'))
  THEN RAISE EXCEPTION 'CORE5 December correction precondition failed'; END IF;

  FOR pair IN SELECT * FROM core5_pairs ORDER BY keep_id LOOP
    SELECT * INTO STRICT fold_row FROM customers WHERE id=pair.fold_id;
    IF fold_row.deleted_at IS NOT NULL THEN
      -- A completed rerun must have no newly introduced child rows.
      FOREACH rel IN ARRAY regular_tables LOOP
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE customer_id::text=$1)',rel) INTO bad USING pair.fold_id::text;
        IF bad THEN RAISE EXCEPTION 'CORE5 rows were added to a folded twin: %',pair.fold_id; END IF;
      END LOOP;
      CONTINUE;
    END IF;
    counts := '{}'::jsonb;
    FOREACH rel IN ARRAY regular_tables LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE customer_id::text=$1 AND business_id<>$2)',rel) INTO bad USING pair.fold_id::text,biz;
      IF bad THEN RAISE EXCEPTION 'CORE5 cross-business child rows in %',rel; END IF;
      IF rel='customer_memory_items' THEN
        EXECUTE format('UPDATE %I SET customer_id=$1 WHERE customer_id=$2 AND business_id=$3',rel) USING pair.keep_id::text,pair.fold_id::text,biz;
      ELSE
        EXECUTE format('UPDATE %I SET customer_id=$1 WHERE customer_id=$2 AND business_id=$3',rel) USING pair.keep_id,pair.fold_id,biz;
      END IF;
      GET DIAGNOSTICS affected = ROW_COUNT;
      counts := counts || jsonb_build_object(rel,affected);
    END LOOP;
    -- Keep the live record's current lifecycle if both exist. The import
    -- singleton remains on the soft-deleted twin as historical provenance.
    UPDATE customer_lifecycle SET customer_id=pair.keep_id
      WHERE customer_id=pair.fold_id AND business_id=biz
        AND NOT EXISTS(SELECT 1 FROM customer_lifecycle WHERE customer_id=pair.keep_id);
    UPDATE customers SET external_refs=(fold_row.external_refs - 'core5_merge') || external_refs,
      has_ticket_pack=EXISTS(SELECT 1 FROM ticket_packs WHERE customer_id=pair.keep_id AND business_id=biz AND status='active'),
      updated_at=now() WHERE id=pair.keep_id AND business_id=biz;
    UPDATE customers SET deleted_at=now(), updated_at=now(),
      external_refs=external_refs || jsonb_build_object('core5_merge',jsonb_build_object(
        'migration',migration,'keep_customer_id',pair.keep_id))
      WHERE id=pair.fold_id AND business_id=biz;
    INSERT INTO audit_log(id,business_id,actor_type,category,action,target_type,target_id,detail)
    VALUES(gen_random_uuid(),biz,'system','customer','merge_duplicate','customer',pair.keep_id::text,
      jsonb_build_object('migration',migration,'fold_customer_id',pair.fold_id,'moved_rows',counts));
  END LOOP;
  IF EXISTS(SELECT 1 FROM pack_redemptions WHERE id='a779da15-2dbd-4262-8c98-5972ddf0310f' AND redeemed_on=DATE '2026-12-25')
    OR EXISTS(SELECT 1 FROM ticket_packs WHERE id='f9e96c87-539a-44fe-8612-3fa07cde3360' AND (purchased_at=DATE '2026-12-25' OR status='active'))
  THEN
    INSERT INTO audit_log(id,business_id,actor_type,category,action,target_type,target_id,detail)
      SELECT gen_random_uuid(),biz,'system','customer','correct_pack_import_date','pack',p.id::text,
        jsonb_build_object('migration',migration,'redemption_id',r.id,
          'previous_redeemed_on',r.redeemed_on,'previous_purchased_at',p.purchased_at,
          'previous_status',p.status,'corrected_date','2025-12-25','corrected_status','exhausted')
      FROM ticket_packs p JOIN pack_redemptions r ON r.pack_id=p.id
      WHERE p.id='f9e96c87-539a-44fe-8612-3fa07cde3360' AND r.id='a779da15-2dbd-4262-8c98-5972ddf0310f';
    WITH corrected_pack AS (
      UPDATE ticket_packs SET purchased_at=DATE '2025-12-25',status='exhausted',updated_at=now()
        WHERE id='f9e96c87-539a-44fe-8612-3fa07cde3360' AND business_id=biz RETURNING id
    ) UPDATE pack_redemptions SET redeemed_on=DATE '2025-12-25'
      WHERE id='a779da15-2dbd-4262-8c98-5972ddf0310f' AND pack_id IN (SELECT id FROM corrected_pack) AND business_id=biz;
    UPDATE customers SET has_ticket_pack=EXISTS(SELECT 1 FROM ticket_packs WHERE customer_id=customers.id AND business_id=biz AND status='active'),updated_at=now()
      WHERE id='1f92d3b9-dbe8-41a9-a4dd-74f58e0486bf' AND business_id=biz;
  END IF;
END $$;
COMMIT;
