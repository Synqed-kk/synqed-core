import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { customerRoutes } from './routes/customers.js'
import { staffRoutes } from './routes/staff.js'
import { appointmentRoutes } from './routes/appointments.js'
import { syncRoutes } from './routes/sync.js'
import { authMiddleware } from './middleware/auth.js'

const app = new Hono().basePath('/v1')

app.use('*', logger())
app.use('*', cors())
app.use('*', authMiddleware)

// Surface runtime errors so we can see them in Vercel logs / smoke tests.
// Dev-only verbosity; safe to keep while we're stabilizing.
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

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = Number(process.env.PORT) || 3100

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`synqed-core running on http://localhost:${info.port}`)
  })
}

export default app
