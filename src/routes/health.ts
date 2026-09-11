/** Health endpoints.
 *
 *  Two of them, on purpose:
 *
 *  - `GET /health` is LIVENESS. Is the process up and serving? No database
 *    work, so it cannot be slow and cannot flap. The platform uses this.
 *
 *  - `GET /health/ready` is READINESS. Can this build actually serve reads —
 *    is the database reachable, and does it have the schema this code was
 *    compiled against? Returns 503 when it cannot. **Point the uptime monitor
 *    and the pager at this one.**
 *
 *  The old `/health` returned a hardcoded `{status:'ok'}` and never touched
 *  the database. Through the whole 2026-09-04 outage it answered 200 while
 *  every record read threw 22P02. A health check that cannot fail is not a
 *  health check; that is why readiness exists and why it is the alerting
 *  target. */

import { Hono } from 'hono'
import { prisma } from '../db/client.js'
import { checkSchemaContract, type SchemaGap } from '../db/schema-contract.js'
import { log } from '../lib/log.js'
import { normalizeError } from '../lib/errors.js'
import { captureSchemaDrift } from '../lib/sentry.js'

export const healthRoutes = new Hono()

/** Liveness. Deliberately does no I/O. */
healthRoutes.get('/', (c) =>
  c.json({ status: 'ok', check: 'liveness', deep: '/v1/health/ready' }),
)

export interface ReadinessResult {
  status: 'ok' | 'degraded'
  database: 'ok' | 'unreachable'
  schema: 'ok' | 'drift' | 'unknown'
  gaps: SchemaGap[]
  checked_at: string
  /** The deploy that answered. Lets a post-deploy probe confirm it is
   *  talking to the NEW build and not the one still being replaced. */
  release: string | null
}

/** The endpoint is unauthenticated so monitors can page on it, and each call
 *  costs a reachability query plus three catalog queries. Without a bound,
 *  public traffic could contend with real requests for connections.
 *
 *  Short on purpose: a monitor polling every 15 minutes always gets a fresh
 *  verdict, while an operator re-probing during a migration waits at most
 *  this long to see their fix land. */
const CACHE_MS = 5_000
let cached: { at: number; result: ReadinessResult } | null = null

/** Testing seam — drops the memo so a case can observe a fresh verdict. */
export function resetReadinessCache(): void {
  cached = null
}

/** Run the deep check. Exported so tests and the boot probe share one path. */
export async function evaluateReadiness(): Promise<ReadinessResult> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result
  const result = await runReadiness()
  cached = { at: Date.now(), result }
  return result
}

async function runReadiness(): Promise<ReadinessResult> {
  const checked_at = new Date().toISOString()
  const release = process.env.VERCEL_GIT_COMMIT_SHA ?? null

  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (e) {
    const n = normalizeError(e)
    log({
      evt: 'health.ready',
      severity: 'error',
      detail: {
        database: 'unreachable',
        kind: n.kind,
        prisma_code: n.prisma_code,
        pg_code: n.pg_code,
        message: n.message,
      },
    })
    return {
      status: 'degraded',
      database: 'unreachable',
      schema: 'unknown',
      gaps: [],
      checked_at,
      release,
    }
  }

  let gaps: SchemaGap[]
  try {
    gaps = await checkSchemaContract()
  } catch (e) {
    const n = normalizeError(e)
    log({
      evt: 'health.ready',
      severity: 'error',
      detail: {
        database: 'ok',
        schema: 'unknown',
        message: n.message,
      },
    })
    return {
      status: 'degraded',
      database: 'ok',
      schema: 'unknown',
      gaps: [],
      checked_at,
      release,
    }
  }

  if (gaps.length > 0) {
    // The line that should have existed on 2026-09-04 at 16:37.
    log({
      evt: 'health.ready',
      severity: 'error',
      detail: {
        database: 'ok',
        schema: 'drift',
        gap_count: gaps.length,
        gaps,
        // Best-effort: a gap carries a migration when MIGRATION_HINTS knows
        // the object. An unattributed gap is still fully reported in `gaps`.
        pending_migrations: [
          ...new Set(gaps.flatMap((g) => (g.migration ? [g.migration] : []))),
        ],
      },
    })
    captureSchemaDrift(gaps)
    return {
      status: 'degraded',
      database: 'ok',
      schema: 'drift',
      gaps,
      checked_at,
      release,
    }
  }

  return {
    status: 'ok',
    database: 'ok',
    schema: 'ok',
    gaps: [],
    checked_at,
    release,
  }
}

healthRoutes.get('/ready', async (c) => {
  const result = await evaluateReadiness()

  // The STATUS is public so any uptime monitor can page on the 503. The gap
  // list names tables, columns and migration files, so it goes only to a
  // caller holding an API key. Alerting does not require disclosure.
  const apiKeys = (process.env.API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const key = c.req.header('x-api-key')
  const authorized = Boolean(key && apiKeys.includes(key))

  const body = authorized ? result : { ...result, gaps: [] }
  return c.json(body, result.status === 'ok' ? 200 : 503)
})
