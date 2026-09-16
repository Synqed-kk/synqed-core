import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Test databases only. Production uses the reviewed manual migration gate.
const database = process.env.DATABASE_URL
if (!database || !['localhost', '127.0.0.1'].includes(new URL(database).hostname)) {
  throw new Error('Family contract setup requires a disposable local database')
}
const audit = readFileSync(new URL('../prisma/migrations/manual/2026-07-17-audit-log-and-soft-deletes.sql', import.meta.url), 'utf8')
const start = audit.indexOf('CREATE OR REPLACE FUNCTION audit_log_block_mutation()')
const end = audit.indexOf('-- The ONE erasure path:', start)
if (start < 0 || end < 0) throw new Error('Audit trigger section not found in the production migration')
// Prisma creates the table/columns. Use the original SQL for the append-only
// function and trigger rather than maintaining a second definition.
execFileSync('psql', [database, '-X', '-v', 'ON_ERROR_STOP=1', '-c', audit.slice(start, end)], { stdio: 'inherit' })
for (const file of ['2026-07-28-pack-redemptions-appointment-unique.sql', '2026-09-07-linked-pack-sharing.sql']) {
  execFileSync('psql', [database, '-X', '-v', 'ON_ERROR_STOP=1', '-f', new URL(`../prisma/migrations/manual/${file}`, import.meta.url).pathname], { stdio: 'inherit' })
}
