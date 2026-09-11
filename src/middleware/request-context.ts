/** Request correlation and access logging.
 *
 *  Every request gets an id: the caller's `x-request-id` when it sent one, a
 *  fresh UUID when it did not. The id goes on the Hono context (so handlers
 *  and audit rows can carry it), onto the response header (so the caller can
 *  record what core called it), and onto one structured line per request.
 *
 *  Core's audit schema already had a `request_id` column. Nothing on the HTTP
 *  path ever produced one, so a Karute 500 could not be traced to the core
 *  request that caused it. During the 2026-09-04 outage that meant the two
 *  halves of the stack failed independently with no shared key between them. */

import { createMiddleware } from 'hono/factory'
import { randomUUID } from 'node:crypto'
import { log } from '../lib/log.js'
import type { AppEnv } from '../types/api.js'

export const REQUEST_ID_HEADER = 'x-request-id'

/** Accept only an id that is safe to put in a log line and a header: printable
 *  ASCII, bounded length. A caller-supplied header is untrusted input; an
 *  unbounded one would let a caller write newlines into the log drain and
 *  forge log entries. */
function sanitizeInboundId(raw: string | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > 200) return null
  return /^[\w.:@/+-]+$/.test(trimmed) ? trimmed : null
}

export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const requestId =
    sanitizeInboundId(c.req.header(REQUEST_ID_HEADER)) ?? randomUUID()

  c.set('requestId', requestId)
  c.header(REQUEST_ID_HEADER, requestId)

  const startedAt = Date.now()
  try {
    await next()
  } finally {
    // Runs even when a handler throws: app.onError logs the CAUSE, this logs
    // the request that carried it. Without the finally, the failing requests —
    // the only ones that matter during an incident — are the ones missing from
    // the access log.
    const status = c.res?.status ?? 500
    log({
      evt: 'http',
      severity: status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
      request_id: requestId,
      business_id: c.get('businessId') ?? null,
      detail: {
        method: c.req.method,
        path: c.req.path,
        status,
        duration_ms: Date.now() - startedAt,
      },
    })
  }
})
