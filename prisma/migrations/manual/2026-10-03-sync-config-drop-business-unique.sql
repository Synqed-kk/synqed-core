-- CORE-43 File B: drop the old one-config-per-business unique on
-- sync_configs (business_id, provider). Apply AFTER the code PR is deployed
-- and one 代官山 crawl has run OK on it. Until this runs, a second store's
-- config row cannot be inserted.
--
-- The old unique's real name and kind differ by database:
--   - fresh `prisma db push`: UNIQUE INDEX sync_configs_business_id_provider_key
--   - production: the column was renamed from tenant_id
--     (rename_tenant_to_business.sql), and Postgres does not rename an index
--     when its column is renamed, so it may be sync_configs_tenant_id_provider_key.
--   - either one may be a CONSTRAINT or only an INDEX.
-- So this file does not hard-code a name. It drops every unique constraint,
-- then every remaining unique index, whose key is exactly
-- {business_id, provider} on sync_configs, and prints each name it drops.
-- Read the real name first (read only):
--   SELECT conname, contype FROM pg_constraint WHERE conrelid = 'sync_configs'::regclass;
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'sync_configs';
-- Idempotent: a second run finds nothing and says so.
-- Fail closed: refuses to run unless File A's per-store unique exists, so the
-- table is never left with no uniqueness at all.
--
-- Rollback (only while every business still has one row per provider):
-- CREATE UNIQUE INDEX sync_configs_business_id_provider_key ON sync_configs (business_id, provider);

BEGIN;

DO $$
DECLARE
  r record;
  dropped int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sync_configs_business_id_provider_karute_store_id_key'
      AND conrelid = 'sync_configs'::regclass
  ) THEN
    RAISE EXCEPTION
      'sync_configs: per-store unique sync_configs_business_id_provider_karute_store_id_key is missing; apply File A first';
  END IF;

  -- Constraints first: dropping one also drops its backing index.
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'sync_configs'::regclass
      AND c.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM unnest(c.conkey) k
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
          = ARRAY['business_id', 'provider']
  LOOP
    EXECUTE format('ALTER TABLE sync_configs DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'sync_configs: dropped unique CONSTRAINT %', r.conname;
    dropped := dropped + 1;
  END LOOP;

  -- Then bare unique indexes (not partial, not on expressions).
  FOR r IN
    SELECT i.indexrelid::regclass::text AS idx
    FROM pg_index i
    WHERE i.indrelid = 'sync_configs'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM unnest(i.indkey::int2[]) k
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k)
          = ARRAY['business_id', 'provider']
  LOOP
    EXECUTE format('DROP INDEX %s', r.idx);
    RAISE NOTICE 'sync_configs: dropped unique INDEX %', r.idx;
    dropped := dropped + 1;
  END LOOP;

  IF dropped = 0 THEN
    RAISE NOTICE 'sync_configs: no unique on (business_id, provider) found; nothing dropped';
  END IF;
END $$;

COMMIT;
