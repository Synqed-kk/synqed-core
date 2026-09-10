/** Sentry for core.
 *
 *  Karute has had Sentry since before the outage. Core — where the failure
 *  actually was — had nothing, so the five-hour 5xx spike paged no one and a
 *  staff member reported it four hours in.
 *
 *  Entirely optional: with no `SENTRY_DSN` every function here is a no-op, so
 *  tests, local dev, and a DSN-less deploy behave exactly as before. An
 *  observability layer must never be the reason a request fails. */

import * as Sentry from '@sentry/node'
import type { NormalizedError } from './errors.js'

let enabled = false

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN
  if (!dsn || enabled) return

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    // Ties an error to the deploy that introduced it. The incident write-up
    // could only correlate the spike to the 16:37 deploy by hand.
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
  })
  enabled = true
}

export interface CaptureContext {
  requestId?: string | null
  businessId?: string | null
  method?: string
  path?: string
  normalized?: NormalizedError
}

/** Report a server error. Never throws. */
export function captureError(e: unknown, ctx: CaptureContext = {}): void {
  if (!enabled) return
  try {
    Sentry.withScope((scope) => {
      if (ctx.requestId) scope.setTag('request_id', ctx.requestId)
      if (ctx.businessId) scope.setTag('business_id', ctx.businessId)
      if (ctx.path) scope.setTag('route', `${ctx.method ?? 'GET'} ${ctx.path}`)

      if (ctx.normalized) {
        const n = ctx.normalized
        scope.setTag('error_kind', n.kind)
        if (n.prisma_code) scope.setTag('prisma_code', n.prisma_code)
        if (n.pg_code) scope.setTag('pg_code', n.pg_code)

        // Schema drift means the deployed code expects a database shape
        // production does not have. It is never a user's fault, it never
        // recovers on its own, and it takes every read down — the loudest
        // level we have, and the one worth a paging rule.
        if (n.kind === 'schema_drift') scope.setLevel('fatal')
      }

      Sentry.captureException(e)
    })
  } catch {
    /* observability must not break the request */
  }
}

/** Report a schema gap found by the readiness probe. Distinct from
 *  captureError: nothing threw, we ASKED and the answer was wrong. */
export function captureSchemaDrift(gaps: unknown[]): void {
  if (!enabled || gaps.length === 0) return
  try {
    Sentry.withScope((scope) => {
      scope.setLevel('fatal')
      scope.setTag('error_kind', 'schema_drift')
      scope.setContext('schema_gaps', { gaps })
      Sentry.captureMessage(
        `Schema drift: ${gaps.length} required object(s) missing from the database`,
      )
    })
  } catch {
    /* observability must not break the request */
  }
}
