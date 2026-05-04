-- Renames every tenant_id column to business_id across all tenant-scoped tables.
-- Run this BEFORE `npm run db:push` so the DB matches the new Prisma schema and
-- Prisma sees no column drop. Index names update automatically; index data is preserved.
--
-- Wrap in a transaction so a partial failure leaves the DB intact.

BEGIN;

ALTER TABLE customers           RENAME COLUMN tenant_id TO business_id;
ALTER TABLE staff               RENAME COLUMN tenant_id TO business_id;
ALTER TABLE appointments        RENAME COLUMN tenant_id TO business_id;
ALTER TABLE sync_configs        RENAME COLUMN tenant_id TO business_id;
ALTER TABLE recording_sessions  RENAME COLUMN tenant_id TO business_id;
ALTER TABLE karute_records      RENAME COLUMN tenant_id TO business_id;
ALTER TABLE org_settings        RENAME COLUMN tenant_id TO business_id;

COMMIT;
