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
}

/** Run the deep check. Exported so tests and the boot probe share one path. */
export async function evaluateReadiness(): Promise<ReadinessResult> {
  const checked_at = new Date().toISOString()

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
        pending_migrations: [...new Set(gaps.map((g) => g.migration))],
      },
    })
    captureSchemaDrift(gaps)
    return {
      status: 'degraded',
      database: 'ok',
      schema: 'drift',
      gaps,
      checked_at,
    }
  }

  return {
    status: 'ok',
    database: 'ok',
    schema: 'ok',
    gaps: [],
    checked_at,
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
