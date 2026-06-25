import { PrismaClient } from '@prisma/client'

// Auth cutover, Stages 2-3: copy auth.users + auth.identities + public.profiles
// from the karute DB into core, VERBATIM (incl. bcrypt encrypted_password),
// preserving ids. Uses json_populate_record so every column type round-trips
// without hand-mapping; generated columns are excluded. Idempotent.
const core = new PrismaClient()
const karute = new PrismaClient({ datasources: { db: { url: process.env.KARUTE_DATABASE_URL } } })

async function insertableCols(schema: string, table: string): Promise<string[]> {
  const rows = await karute.$queryRawUnsafe<{ column_name: string }[]>(
    `select column_name from information_schema.columns
       where table_schema=$1 and table_name=$2 and is_generated='NEVER'
       order by ordinal_position`,
    schema, table,
  )
  return rows.map((r) => r.column_name)
}

async function copyTable(opts: {
  schema: string; table: string; conflict: string; where?: string; label: string; upsert?: boolean
}): Promise<void> {
  const { schema, table, conflict, where, label, upsert } = opts
  const cols = await insertableCols(schema, table)
  const colList = cols.map((c) => `"${c}"`).join(', ')
  const qualified = `${schema}.${table}`
  // For profiles: the handle_new_user trigger fires on the auth.users insert and
  // creates a throwaway-business profile, so we UPSERT to overwrite it with the
  // real karute row (correct customer_id / role / permissions).
  const onConflict = upsert
    ? `on conflict (${conflict}) do update set ${cols
        .filter((c) => c !== conflict)
        .map((c) => `"${c}"=excluded."${c}"`)
        .join(', ')}`
    : `on conflict (${conflict}) do nothing`
  const rows = await karute.$queryRawUnsafe<Record<string, unknown>[]>(
    `select to_jsonb(t) as j from ${qualified} t ${where ? 'where ' + where : ''}`,
  )
  let affected = 0
  for (const row of rows) {
    const res = await core.$executeRawUnsafe(
      `insert into ${qualified} (${colList})
       select ${colList} from jsonb_populate_record(null::${qualified}, $1::jsonb)
       ${onConflict}`,
      JSON.stringify((row as { j: unknown }).j),
    )
    affected += res
  }
  console.log(`${label}: ${affected}/${rows.length} ${upsert ? 'upserted' : 'inserted'}`)
}

async function main() {
  // Order matters: auth.users before profiles (FK profiles.id -> auth.users.id).
  await copyTable({ schema: 'auth', table: 'users', conflict: 'id', label: 'auth.users' })
  await copyTable({ schema: 'auth', table: 'identities', conflict: 'id', label: 'auth.identities' })
  // Only profiles that have a matching auth user (skip the leftover E2E orphan).
  await copyTable({
    schema: 'public', table: 'profiles', conflict: 'id', label: 'public.profiles',
    where: 'id in (select id from auth.users)', upsert: true,
  })

  // Sanity: counts + that passwords came across.
  const u = await core.$queryRawUnsafe<{ n: number; pw: number }[]>(
    `select count(*)::int n, count(*) filter (where encrypted_password is not null and encrypted_password <> '')::int pw from auth.users`,
  )
  const p = await core.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int n from public.profiles`)
  console.log(`\ncore now: auth.users=${u[0].n} (with_password=${u[0].pw}), profiles=${p[0].n}`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(async () => { await core.$disconnect(); await karute.$disconnect() })
