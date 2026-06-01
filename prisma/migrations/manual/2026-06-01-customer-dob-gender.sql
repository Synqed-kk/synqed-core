-- Adds the two customer demographic columns the Karute edit-customer form needs
-- (date_of_birth + gender). Both NULLABLE and additive: existing rows get NULL,
-- no table rewrite, no lock of consequence, no data touched. Idempotent so it's
-- safe to re-run. Matches prisma/schema.prisma (dateOfBirth @db.Date, gender String?).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender        text;
