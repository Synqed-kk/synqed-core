import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Adding cost-tracking columns to ai_request_log...')
  await prisma.$executeRawUnsafe(`
    alter table ai_request_log
      add column if not exists tokens_in int,
      add column if not exists tokens_out int,
      add column if not exists cost_cents int;
  `)
  console.log('done.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
