// Dumps every user-owned table in the `public` schema to a JSON file.
// Run BEFORE prisma db push --force-reset to save current dev data,
// then run scripts/seed-from-dump.ts AFTER the reset to replay.
//
// Usage:
//   npx tsx scripts/dump-dev-data.ts [--out=dev-data.json]

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const outPath = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? 'dev-data.json'

interface TableRow {
  tablename: string
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const tables = await prisma.$queryRawUnsafe<TableRow[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )

    const dump: Record<string, unknown[]> = {}
    for (const { tablename } of tables) {
      // Quoted to handle snake_case or reserved-word table names safely.
      const rows = await prisma.$queryRawUnsafe<unknown[]>(
        `SELECT * FROM "${tablename}"`,
      )
      dump[tablename] = rows
      console.log(`  ${tablename}: ${rows.length} rows`)
    }

    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(
      outPath,
      JSON.stringify(dump, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
    )
    console.log(`\nDumped ${tables.length} tables → ${outPath}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
