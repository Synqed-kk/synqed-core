import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Adding missing columns to profiles...')
  await prisma.$executeRawUnsafe(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS position text;`)
  await prisma.$executeRawUnsafe(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;`)
  await prisma.$executeRawUnsafe(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;`)
  await prisma.$executeRawUnsafe(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;`)
  await prisma.$executeRawUnsafe(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_hash text;`)
  console.log('Done.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
