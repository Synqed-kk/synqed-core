import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Creating ai_request_log table...')
  await prisma.$executeRawUnsafe(`
    create table if not exists ai_request_log (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null,
      route text not null,
      created_at timestamptz not null default now()
    );
  `)
  await prisma.$executeRawUnsafe(`
    create index if not exists ai_request_log_business_id_created_at_idx
      on ai_request_log (business_id, created_at);
  `)
  console.log('done.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
