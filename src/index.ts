import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { customerRoutes } from './routes/customers.js'
import { authMiddleware } from './middleware/auth.js'

const app = new Hono().basePath('/v1')

app.use('*', logger())
app.use('*', cors())
app.use('*', authMiddleware)

app.route('/customers', customerRoutes)

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = Number(process.env.PORT) || 3100

if (process.env.NODE_ENV !== 'production') {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`synqed-core running on http://localhost:${info.port}`)
  })
}

export default app
