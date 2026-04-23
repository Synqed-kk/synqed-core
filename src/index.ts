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

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = Number(process.env.PORT) || 3100

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`synqed-core running on http://localhost:${info.port}`)
  })
}

export default app
