CREATE TABLE IF NOT EXISTS "customer_photos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "storage_path" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'general',
  "caption" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "customer_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_photos_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "customer_photos_business_id_idx" ON "customer_photos"("business_id");
CREATE INDEX IF NOT EXISTS "customer_photos_customer_id_created_at_idx" ON "customer_photos"("customer_id", "created_at");
