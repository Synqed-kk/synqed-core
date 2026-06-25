import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const here = dirname(fileURLToPath(import.meta.url))

/** Split SQL into statements, respecting $tag$...$tag$ dollar-quoted blocks
 *  (function bodies contain ';'). Strips `--` comment lines + BEGIN/COMMIT. */
function splitStatements(sql: string): string[] {
  const noComments = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  const out: string[] = []
  let buf = ''
  let dollarTag: string | null = null
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i]
    if (dollarTag) {
      buf += ch
      if (ch === '$') {
        const m = noComments.slice(i).match(/^\$[a-zA-Z0-9_]*\$/)
        if (m && m[0] === dollarTag) { buf += m[0].slice(1); i += m[0].length - 1; dollarTag = null }
      }
      continue
    }
    if (ch === '$') {
      const m = noComments.slice(i).match(/^\$[a-zA-Z0-9_]*\$/)
      if (m) { dollarTag = m[0]; buf += m[0]; i += m[0].length - 1; continue }
    }
    if (ch === ';') { out.push(buf.trim()); buf = ''; continue }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
    .map((s) => s.trim())
    .filter((s) => s && !/^(BEGIN|COMMIT)$/i.test(s))
}

async function main() {
  const sql = readFileSync(join(here, '../prisma/migrations/manual/2026-06-25-auth-profiles.sql'), 'utf8')
  const statements = splitStatements(sql)
  for (const stmt of statements) {
    console.log('▸ ' + stmt.split('\n')[0].slice(0, 64) + ' …')
    await prisma.$executeRawUnsafe(stmt)
  }
  const cols = await prisma.$queryRawUnsafe(
    `select count(*)::int n from information_schema.columns where table_schema='public' and table_name='profiles'`,
  )
  console.log(`\nStage 1 applied (${statements.length} statements). core profiles columns:`, JSON.stringify(cols))
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
