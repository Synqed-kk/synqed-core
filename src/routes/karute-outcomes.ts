import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import * as outcomeService from '../services/karute-outcome.service.js'

export const karuteOutcomeRoutes = new Hono<AppEnv>()

// Read a session's outcome by karute record id (business-scoped).
karuteOutcomeRoutes.get('/:karuteRecordId', async (c) => {
  const businessId = c.get('businessId')
  const outcome = await outcomeService.getOutcome(businessId, c.req.param('karuteRecordId'))
  if (!outcome) return c.json({ error: 'Outcome not found' }, 404)
  return c.json(outcome)
})

// Upsert a session's outcome (keyed on karute_record_id).
karuteOutcomeRoutes.put('/', async (c) => {
  const businessId = c.get('businessId')
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.karute_record_id !== 'string' || typeof b.outcome !== 'string') {
    return c.json({ error: 'karute_record_id and outcome required' }, 400)
  }
  const outcome = await outcomeService.upsertOutcome(businessId, {
    karute_record_id: b.karute_record_id,
    customer_id: typeof b.customer_id === 'string' ? b.customer_id : null,
    outcome: b.outcome,
    reason: typeof b.reason === 'string' ? b.reason : null,
    is_first_visit: typeof b.is_first_visit === 'boolean' ? b.is_first_visit : false,
    decided_by: typeof b.decided_by === 'string' ? b.decided_by : null,
    decided_at: typeof b.decided_at === 'string' ? b.decided_at : null,
    auto_decided: typeof b.auto_decided === 'boolean' ? b.auto_decided : false,
  })
  return c.json(outcome)
})
