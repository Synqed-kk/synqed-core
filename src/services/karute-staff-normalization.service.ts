import { Prisma } from '@prisma/client'
import { prisma } from '../db/client.js'

interface NormalizationReport {
  total: number
  changeable: number
  unresolved: number
  ambiguous: number
  issues: Array<{ record_id: string; staff_id: string; matches: number }>
  changed: number
}

/** Operator-only repair; deliberately has no HTTP route. Preview is the default. */
export async function normalizeKaruteStaffIdentities(
  businessId: string,
  apply = false,
): Promise<NormalizationReport> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`
    // Freeze the candidate namespace and records together, including inserts.
    // Locks also serialize concurrent repair runs; no duplicate audit entries.
    await tx.$executeRaw`LOCK TABLE staff IN SHARE MODE`
    await tx.$executeRaw`LOCK TABLE karute_records IN SHARE ROW EXCLUSIVE MODE`
    const mapping = Prisma.sql`
      SELECT k.id, k.business_id, k.store_id, k.staff_id,
        count(s.id)::int AS matches, min(s.id::text)::uuid AS canonical_id
      FROM karute_records k
      LEFT JOIN staff s ON s.business_id = k.business_id
        AND (s.id = k.staff_id OR s.user_id = k.staff_id)
      WHERE k.business_id = ${businessId}::uuid
      GROUP BY k.id
    `
    const [report] = await tx.$queryRaw<Omit<NormalizationReport, 'changed'>[]>(Prisma.sql`
      WITH mapping AS (${mapping})
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE matches = 1 AND staff_id <> canonical_id)::int AS changeable,
        count(*) FILTER (WHERE matches = 0)::int AS unresolved,
        count(*) FILTER (WHERE matches > 1)::int AS ambiguous,
        COALESCE((SELECT jsonb_agg(issue) FROM (
          SELECT id AS record_id, staff_id, matches FROM mapping
          WHERE matches <> 1 ORDER BY id LIMIT 100
        ) issue), '[]'::jsonb) AS issues
      FROM mapping
    `)
    if (!apply) return { ...report, changed: 0 }
    if (report.unresolved || report.ambiguous) {
      throw new Error(`Normalization refused: ${report.unresolved} unresolved, ${report.ambiguous} ambiguous records; run preview for IDs`)
    }
    const changed = await tx.$executeRaw(Prisma.sql`
      WITH mapping AS (${mapping}), changed AS (
        UPDATE karute_records k SET staff_id = m.canonical_id
        FROM mapping m WHERE k.id = m.id AND m.matches = 1
          AND m.staff_id <> m.canonical_id
        RETURNING k.id, k.business_id, k.store_id, m.staff_id AS previous_staff_id, k.staff_id
      )
      INSERT INTO audit_log
        (id, business_id, store_id, actor_type, category, action, target_type, target_id, detail)
      SELECT gen_random_uuid(), business_id, store_id, 'system', 'karute',
        'normalize_staff_identity', 'karute_record', id::text,
        jsonb_build_object('previous_staff_id', previous_staff_id, 'staff_id', staff_id,
          'reason', 'CORE-4 permanent staff card normalization')
      FROM changed
    `)
    return { ...report, changed }
  }, { timeout: 60_000 })
}
