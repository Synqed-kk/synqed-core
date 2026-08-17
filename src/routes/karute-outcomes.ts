import { Hono } from 'hono'
import type { AppEnv } from '../types/api.js'
import * as outcomeService from '../services/karute-outcome.service.js'

export const karuteOutcomeRoutes = new Hono<AppEnv>()

// Business-scoped list — the auto-close cron's query (?outcome=pending&
// updated_before=<now-14d>). Registered before '/:karuteRecordId' so the
// literal path isn't eaten by the param.
karuteOutcomeRoutes.get('/', async (c) => {
  const businessId = c.get('businessId')
  const q = c.req.query()
  if (q.updated_before !== undefined && Number.isNaN(Date.parse(q.updated_before))) {
    return c.json({ error: 'updated_before must be an ISO datetime' }, 400)
  }
  const page = q.page !== undefined ? Number(q.page) : undefined
  const pageSize = q.page_size !== undefined ? Number(q.page_size) : undefined
  if ((page !== undefined && (!Number.isInteger(page) || page < 1)) ||
      (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1))) {
    return c.json({ error: 'page and page_size must be positive integers' }, 400)
  }
  const result = await outcomeService.listOutcomes(businessId, {
    outcome: q.outcome,
    decision_context: q.decision_context,
    updated_before: q.updated_before,
    page,
    page_size: pageSize,
  })
  return c.json(result)
})

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
    decision_context: b.decision_context === 'conversion' || b.decision_context === 'repurchase' ? b.decision_context : null,
    is_first_visit: typeof b.is_first_visit === 'boolean' ? b.is_first_visit : false,
    decided_by: typeof b.decided_by === 'string' ? b.decided_by : null,
    decided_at: typeof b.decided_at === 'string' ? b.decided_at : null,
    auto_decided: typeof b.auto_decided === 'boolean' ? b.auto_decided : false,
  })
  return c.json(outcome)
})
