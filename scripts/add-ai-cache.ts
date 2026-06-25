import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ai_cache (cache_key text PRIMARY KEY, result jsonb NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS ai_cache_expires_idx ON ai_cache (expires_at);`)
  await prisma.$executeRawUnsafe(`ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;`)
  console.log('ai_cache table created.')
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect())
