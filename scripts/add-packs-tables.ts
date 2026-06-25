import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const here = dirname(fileURLToPath(import.meta.url))

async function main() {
  const sql = readFileSync(join(here, '../prisma/migrations/manual/2026-06-25-packs-subsystem.sql'), 'utf8')
  // Strip `--` comment lines FIRST (a ';' inside a comment would break the split),
  // then drop the BEGIN/COMMIT wrapper and run each statement on the single conn.
  const body = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/^\s*BEGIN;\s*/i, '')
    .replace(/\s*COMMIT;\s*$/i, '')
  const statements = body.split(';').map((s) => s.trim()).filter(Boolean)
  for (const stmt of statements) {
    console.log(stmt.split('\n')[0].slice(0, 70) + ' ...')
    await prisma.$executeRawUnsafe(stmt)
  }
  console.log(`Done — ${statements.length} statements.`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
