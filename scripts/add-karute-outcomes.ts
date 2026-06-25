import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Creating karute_outcomes table...')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS karute_outcomes (
      karute_record_id uuid PRIMARY KEY,
      business_id      uuid NOT NULL,
      customer_id      uuid,
      outcome          text NOT NULL,
      reason           text,
      is_first_visit   boolean NOT NULL DEFAULT false,
      decided_by       uuid,
      decided_at       timestamptz,
      auto_decided     boolean NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  `)
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS karute_outcomes_business_id_idx ON karute_outcomes (business_id);`,
  )
  await prisma.$executeRawUnsafe(`ALTER TABLE karute_outcomes ENABLE ROW LEVEL SECURITY;`)
  console.log('Done.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
