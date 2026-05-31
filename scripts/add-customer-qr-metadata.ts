import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Adds the returning-customer signal + lifetime visit count to customers.
// Populated by external syncs (QuickReserve is_existing_customer /
// visits_number_cache). Additive + idempotent (IF NOT EXISTS + defaults), so
// safe to run against an existing prod table.
async function main() {
  console.log('Adding QR metadata columns to customers...')
  await prisma.$executeRawUnsafe(
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_existing_customer boolean NOT NULL DEFAULT false;`,
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 0;`,
  )
  console.log('Done.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
