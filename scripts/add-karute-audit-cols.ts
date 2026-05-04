import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Adding last_edited_by_staff_id to karute_records...')
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "karute_records" ADD COLUMN IF NOT EXISTS "last_edited_by_staff_id" UUID;`,
  )
  console.log('Done.')
}

main().catch((err) => { console.error(err); process.exit(1) }).finally(() => prisma.$disconnect())
