-- Deep customer crawl (QuickReserve): additive profile + summary columns on
-- customers, plus the customer_visits table (one row per QR reservation).
-- All columns NULLABLE or DEFAULTed and additive: existing rows get sane
-- defaults, no table rewrite. Idempotent so it's safe to re-run.
-- Matches prisma/schema.prisma (Customer extensions + CustomerVisit model).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS occupation text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS member_number text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS prefecture text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone2 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dm_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS remarks2 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_sales integer NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS installment_outstanding integer NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS has_ticket_pack boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_visit_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_visit_at timestamptz;

CREATE TABLE IF NOT EXISTS customer_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  qr_reservation_id integer NOT NULL,
  used_at timestamptz NOT NULL,
  status text NOT NULL,
  course_name text,
  sales_amount integer NOT NULL DEFAULT 0,
  staff_name text,
  treatment_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, qr_reservation_id)
);
CREATE INDEX IF NOT EXISTS customer_visits_customer_used_idx ON customer_visits (customer_id, used_at);
