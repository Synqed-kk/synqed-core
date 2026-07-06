-- Make the customer-slot uniqueness terminal-aware.
--
-- The old constraint UNIQUE(business_id, customer_id, starts_at) ignored status,
-- so it blocked a customer from rebooking a slot they'd CANCELLED or NO_SHOW'd
-- (a customer cancels 14:00, then rebooks 14:00 → collision). It also blocked
-- createAppointment from filling a no-show slot.
--
-- Replace it with a PARTIAL unique index that only covers live bookings. Active
-- bookings still can't collide (twin-dedup + the QR adopt-on-conflict path both
-- rely on this), but a terminal (cancelled / no-show) row no longer reserves the
-- slot.
--
-- Order: create the partial index FIRST so the table is never, for any instant,
-- without active-twin protection; then drop the old full constraint.
--
-- The index name deliberately contains "starts_at": once @@unique is gone from
-- the Prisma schema, Prisma reports P2002 meta.target as this raw index NAME (not
-- a column array), and isUniqueViolation(e, 'starts_at') matches by substring.
-- Both the createAppointment 409 catch and the QR sync adopt-on-conflict path
-- depend on that match — do NOT rename this index without updating them.

CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_customer_starts_at_uidx
  ON appointments (business_id, customer_id, starts_at)
  WHERE status NOT IN ('CANCELLED', 'NO_SHOW');

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_business_id_customer_id_starts_at_key;
