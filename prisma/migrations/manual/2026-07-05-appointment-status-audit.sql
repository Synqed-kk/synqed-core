-- Staff cancellation / NO_SHOW: enum value, StatusSource, audit columns, and a
-- non-visit flag on redemptions. Additive; existing rows take the defaults
-- (SYSTEM / true) with no data change.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` must be committed before the value is used,
-- so it is run on its own (not in the same transaction as any use of NO_SHOW).

ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';

-- The rest is a plain additive DDL batch.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StatusSource') THEN
    CREATE TYPE "StatusSource" AS ENUM ('SYSTEM', 'QR', 'STAFF');
  END IF;
END $$;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS status_source "StatusSource" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS status_set_by uuid,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_set_at timestamptz;

ALTER TABLE pack_redemptions
  ADD COLUMN IF NOT EXISTS counts_as_visit boolean NOT NULL DEFAULT true;
