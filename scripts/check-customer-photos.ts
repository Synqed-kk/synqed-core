import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'customer_photos' ORDER BY ordinal_position;`,
  )
  console.log('customer_photos columns:')
  console.table(cols)

  const counts = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM customer_photos;`,
  )
  console.log('row count:', counts[0].count.toString())

  const sample = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM customer_photos LIMIT 3;`,
  )
  console.log('sample:', sample)

  const businessIdCheck = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM customer_photos WHERE business_id IS NULL;`,
  )
  console.log('rows missing business_id:', businessIdCheck[0].count.toString())
}

main().catch((err) => { console.error(err); process.exit(1) }).finally(() => prisma.$disconnect())
