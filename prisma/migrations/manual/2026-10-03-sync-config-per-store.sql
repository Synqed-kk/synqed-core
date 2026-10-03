-- CORE-43 File A: one Quick Reserve config per STORE, not per business.
-- Apply BEFORE the code PR deploys. Every statement is safe for today's code:
-- the old (business_id, provider) unique STAYS (today's code upserts on it).
-- File B (a separate PR, applied after the deploy) drops it later.
-- Fail closed: a config row on a business with no primary store stops the
-- whole file. Never guess a store.
--
-- Pre-check (read only; run first and paste the result in the PR). If any
-- row other than La Estro's has a null karute_store_id on a business with
-- more than one store, STOP and report it:
--
--   SELECT sc.id, sc.business_id, sc.provider, sc.karute_store_id,
--          (SELECT count(*) FROM stores s WHERE s.business_id = sc.business_id) AS stores,
--          (SELECT s.id FROM stores s WHERE s.business_id = sc.business_id AND s.is_primary) AS primary_store
--   FROM sync_configs sc;
--
-- If the exception below fires, the rows to report are those with a null
-- primary_store in the pre-check output.
--
-- Merge gate (after this file, before the code PR merges): every enabled row
-- must have crawled OK since this file ran. last_run_at alone is not enough;
-- a failed run sets it too. This must return zero rows:
--
--   SELECT id, business_id, karute_store_id, last_run_status, last_run_at
--   FROM sync_configs
--   WHERE enabled AND (last_run_status IS DISTINCT FROM 'OK'
--                      OR last_run_at IS NULL OR last_run_at <= '<File A applied at>');
--
-- Rollback: ALTER TABLE sync_configs DROP CONSTRAINT IF EXISTS
-- sync_configs_business_id_provider_karute_store_id_key; ALTER TABLE
-- sync_configs ALTER COLUMN karute_store_id DROP NOT NULL;

BEGIN;

-- Backfill from the business's primary store. stores_one_primary_per_business
-- guarantees at most one primary per business. updated_at is set by hand:
-- @updatedAt is client-side only.
UPDATE sync_configs sc
SET karute_store_id = s.id, updated_at = now()
FROM stores s
WHERE s.business_id = sc.business_id
  AND s.is_primary
  AND sc.karute_store_id IS NULL;

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM sync_configs WHERE karute_store_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'sync_configs: % row(s) still have no karute_store_id (business has no primary store)',
      n;
  END IF;
END $$;

ALTER TABLE sync_configs ALTER COLUMN karute_store_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sync_configs_business_id_provider_karute_store_id_key'
      AND conrelid = 'sync_configs'::regclass
  ) THEN
    ALTER TABLE sync_configs
      ADD CONSTRAINT sync_configs_business_id_provider_karute_store_id_key
      UNIQUE (business_id, provider, karute_store_id);
  END IF;
END $$;

COMMIT;
