import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { customerRoutes } from './routes/customers.js'
import { staffRoutes } from './routes/staff.js'
import { appointmentRoutes } from './routes/appointments.js'
import { syncRoutes } from './routes/sync.js'
import { recordingRoutes } from './routes/recordings.js'
import { karuteRoutes } from './routes/karute.js'
import { orgSettingsRoutes } from './routes/org-settings.js'
import { aiRateLimitRoutes } from './routes/ai-rate-limit.js'
import { adminRoutes } from './routes/admin.js'
import { storeRoutes } from './routes/stores.js'
import { menuRoutes } from './routes/menus.js'
import { entitlementRoutes } from './routes/entitlements.js'
import { staffStoreRoutes } from './routes/staff-stores.js'
import { businessGrantRoutes } from './routes/business-grants.js'
import { pricingRuleRoutes } from './routes/pricing-rules.js'
import { storePolicyRoutes } from './routes/store-policies.js'
import { qualificationRoutes } from './routes/qualifications.js'
import { recordingDiscardRoutes } from './routes/recording-discards.js'
import { retentionSignalRoutes } from './routes/retention-signals.js'
import { permissionRoutes } from './routes/permissions.js'
import { policyEventRoutes } from './routes/policy-events.js'
import { resourceRoutes } from './routes/resources.js'
import { inviteRoutes } from './routes/invites.js'
import { customerMemoryRoutes } from './routes/customer-memory.js'
import { karuteOutcomeRoutes } from './routes/karute-outcomes.js'
import { packRoutes } from './routes/packs.js'
import { auditRoutes } from './routes/audit.js'
import { recordingJobRoutes } from './routes/recording-jobs.js'
import { aiCacheRoutes } from './routes/ai-cache.js'
import { authMiddleware } from './middleware/auth.js'
import { requestContext } from './middleware/request-context.js'
import { healthRoutes, evaluateReadiness } from './routes/health.js'
import { log } from './lib/log.js'
import { normalizeError } from './lib/errors.js'
import { initSentry, captureError } from './lib/sentry.js'
import type { AppEnv } from './types/api.js'

initSentry()

const app = new Hono<AppEnv>().basePath('/v1')

// requestContext FIRST: a request rejected by auth still needs an id and an
// access-log line. Hono's own logger() is gone — it wrote unstructured prose
// that could not be grouped or alerted on, which is the whole defect here.
app.use('*', requestContext)
app.use('*', cors())
app.use('*', authMiddleware)

app.onError((err, c) => {
  const normalized = normalizeError(err)
  const requestId = c.get('requestId') ?? null
  const businessId = c.get('businessId') ?? null

  log({
    evt: 'error',
    severity: 'error',
    request_id: requestId,
    business_id: businessId,
    detail: {
      kind: normalized.kind,
      prisma_code: normalized.prisma_code,
      pg_code: normalized.pg_code,
      message: normalized.message,
      method: c.req.method,
      path: c.req.path,
      stack: err instanceof Error ? err.stack : null,
    },
  })

  captureError(err, {
    requestId,
    businessId,
    method: c.req.method,
    path: c.req.path,
    normalized,
  })

  // Schema drift is an operator problem, not a caller problem: the database
  // lacks something this build requires and no retry will fix it. Say so with
  // 503 rather than a 500 that reads like a transient bug.
  if (normalized.kind === 'schema_drift') {
    return c.json(
      { error: 'Service temporarily unavailable: database schema mismatch' },
      503,
    )
  }

  return c.json(
    { error: err instanceof Error ? err.message : 'Internal server error' },
    500,
  )
})

app.route('/customers', customerRoutes)
app.route('/staff', staffRoutes)
app.route('/appointments', appointmentRoutes)
app.route('/sync', syncRoutes)
app.route('/recordings', recordingRoutes)
app.route('/karute-records', karuteRoutes)
app.route('/org-settings', orgSettingsRoutes)
app.route('/ai-rate-limit', aiRateLimitRoutes)
app.route('/admin', adminRoutes)
app.route('/stores', storeRoutes)
app.route('/menus', menuRoutes)
app.route('/entitlements', entitlementRoutes)
app.route('/staff-stores', staffStoreRoutes)
app.route('/business-grants', businessGrantRoutes)
app.route('/pricing-rules', pricingRuleRoutes)
app.route('/store-policies', storePolicyRoutes)
app.route('/qualifications', qualificationRoutes)
app.route('/recording-discards', recordingDiscardRoutes)
app.route('/retention-signals', retentionSignalRoutes)
app.route('/permissions', permissionRoutes)
app.route('/policy-events', policyEventRoutes)
app.route('/resources', resourceRoutes)
app.route('/invites', inviteRoutes)
app.route('/customer-memory', customerMemoryRoutes)
app.route('/karute-outcomes', karuteOutcomeRoutes)
app.route('/packs', packRoutes)
app.route('/audit', auditRoutes)
app.route('/recording-jobs', recordingJobRoutes)
app.route('/ai-cache', aiCacheRoutes)

app.route('/health', healthRoutes)

const port = Number(process.env.PORT) || 3100

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, (info) => {
    log({ evt: 'boot', detail: { port: info.port } })
    // Probe the schema once at boot so drift is announced at startup rather
    // than discovered by the first user. Deliberately does NOT abort: refusing
    // to start would turn a degraded deploy into a total outage, and readiness
    // already reports 503 for the load balancer.
    void evaluateReadiness()
  })
}

export default app
