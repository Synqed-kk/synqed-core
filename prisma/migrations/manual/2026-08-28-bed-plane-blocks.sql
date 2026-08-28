-- Bed plane phase 2, item 6: customerless/staffless BLOCK rows.
--
-- kind=BOOKING keeps the original contract — the CHECK below re-imposes
-- customer_id/staff_id NOT NULL for bookings, so relaxing the columns only
-- opens the door for kind=BLOCK (maintenance, breaks, private holds).
-- A block never has a customer; it must occupy staff OR a bed (service-
-- enforced: staff_id or resource_id present).
--
-- Existing partial unique (business, customer, starts_at) is unaffected:
-- Postgres treats NULL customer_id as distinct, so blocks never collide
-- there. The bed EXCLUDE constraint applies to blocks exactly like bookings
-- — a bedded block occupies the bed.
--
-- Rollback (only if no BLOCK rows exist):
--   DELETE FROM appointments WHERE kind = 'BLOCK';
--   ALTER TABLE appointments DROP CONSTRAINT appointments_booking_requires_parties;
--   ALTER TABLE appointments ALTER COLUMN customer_id SET NOT NULL,
--     ALTER COLUMN staff_id SET NOT NULL, DROP COLUMN kind;
--   DROP TYPE "AppointmentKind";

BEGIN;

DO $$ BEGIN
  CREATE TYPE "AppointmentKind" AS ENUM ('BOOKING', 'BLOCK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS kind "AppointmentKind" NOT NULL DEFAULT 'BOOKING';

ALTER TABLE appointments
  ALTER COLUMN customer_id DROP NOT NULL,
  ALTER COLUMN staff_id DROP NOT NULL;

-- The old NOT NULL contract, scoped to bookings; blocks are customerless by
-- definition (customer_id must be NULL).
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_booking_requires_parties;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_booking_requires_parties
  CHECK (
    (kind = 'BOOKING' AND customer_id IS NOT NULL AND staff_id IS NOT NULL)
    OR (kind = 'BLOCK' AND customer_id IS NULL)
  );

COMMIT;
