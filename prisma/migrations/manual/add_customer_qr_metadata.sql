-- Returning-customer signal + lifetime visit count on customers.
-- Populated by external syncs (QuickReserve is_existing_customer /
-- visits_number_cache); defaults cover in-app-created customers.
-- Additive + idempotent. Applied via scripts/add-customer-qr-metadata.ts.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_existing_customer boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 0;
