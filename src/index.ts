import { Hono } from 'hono'
import { logger } from 'hono/logger'
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
import { entitlementRoutes } from './routes/entitlements.js'
import { staffStoreRoutes } from './routes/staff-stores.js'
import { inviteRoutes } from './routes/invites.js'
import { customerMemoryRoutes } from './routes/customer-memory.js'
import { karuteOutcomeRoutes } from './routes/karute-outcomes.js'
import { packRoutes } from './routes/packs.js'
import { auditRoutes } from './routes/audit.js'
import { recordingJobRoutes } from './routes/recording-jobs.js'
import { aiCacheRoutes } from './routes/ai-cache.js'
import { authMiddleware } from './middleware/auth.js'

const app = new Hono().basePath('/v1')

app.use('*', logger())
app.use('*', cors())
app.use('*', authMiddleware)

app.onError((err, c) => {
  console.error('[synqed-core] unhandled error:', err)
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
app.route('/entitlements', entitlementRoutes)
app.route('/staff-stores', staffStoreRoutes)
app.route('/invites', inviteRoutes)
app.route('/customer-memory', customerMemoryRoutes)
app.route('/karute-outcomes', karuteOutcomeRoutes)
app.route('/packs', packRoutes)
app.route('/audit', auditRoutes)
app.route('/recording-jobs', recordingJobRoutes)
app.route('/ai-cache', aiCacheRoutes)

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = Number(process.env.PORT) || 3100

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`synqed-core running on http://localhost:${info.port}`)
  })
}

export default app
