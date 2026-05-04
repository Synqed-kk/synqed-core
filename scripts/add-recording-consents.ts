import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Creating ConsentMethod enum + recording_consents table...')

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "ConsentMethod" AS ENUM ('VERBAL', 'WRITTEN');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "recording_consents" (
      "id" UUID NOT NULL DEFAULT gen_random_uuid(),
      "business_id" UUID NOT NULL,
      "customer_id" UUID NOT NULL,
      "granted_by_staff_id" UUID NOT NULL,
      "granted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "method" "ConsentMethod" NOT NULL DEFAULT 'VERBAL',
      "policy_version" TEXT NOT NULL,
      "revoked_at" TIMESTAMPTZ,
      "revoked_by_staff_id" UUID,
      CONSTRAINT "recording_consents_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "recording_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE
    );
  `)

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "recording_consents_business_id_idx" ON "recording_consents"("business_id");`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "recording_consents_customer_id_revoked_at_idx" ON "recording_consents"("customer_id", "revoked_at");`)

  console.log('Done.')
}

main().catch((err) => { console.error(err); process.exit(1) }).finally(() => prisma.$disconnect())
