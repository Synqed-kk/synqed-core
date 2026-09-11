import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const gaps = [
  { kind: 'enum_value' as const, subject: 'KaruteStatus.DISCARDED' },
  {
    kind: 'constraint' as const,
    subject: 'recording_discard_events.rde_confirmation_pair',
    migration: '2026-09-03-recording-discard-confirmation',
  },
]

// Reproduce production at 16:37 on 2026-09-04: the database is up and healthy,
// but four manual migrations were never applied. Every value below is what the
// real probe would have returned that afternoon.
vi.mock('../src/db/schema-contract.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/db/schema-contract.js')
  >()
  return { ...actual, checkSchemaContract: vi.fn(async () => gaps) }
})

const { default: app } = await import('../src/index.js')
const { resetReadinessCache } = await import('../src/routes/health.js')

beforeEach(() => {
  vi.clearAllMocks()
  // Readiness memoizes its verdict; each case must see its own probe.
  resetReadinessCache()
})

describe('readiness under the 2026-09-04 conditions', () => {
  it('answers 503, not 200', async () => {
    // The whole point. The old /health answered 200 for five hours.
    const res = await app.request('/v1/health/ready')
    expect(res.status).toBe(503)
  })

  it('names schema drift rather than blaming the database', async () => {
    const res = await app.request('/v1/health/ready')
    const body = await res.json()

    expect(body.status).toBe('degraded')
    expect(body.database).toBe('ok')
    expect(body.schema).toBe('drift')
  })

  it('gives an authorized caller the exact objects to fix', async () => {
    const res = await app.request('/v1/health/ready', {
      headers: { 'x-api-key': TEST_API_KEY },
    })
    const body = await res.json()

    expect(body.gaps).toHaveLength(2)
    expect(body.gaps.map((g: { subject: string }) => g.subject)).toContain(
      'KaruteStatus.DISCARDED',
    )
    expect(body.gaps.map((g: { migration?: string }) => g.migration)).toContain(
      '2026-09-03-recording-discard-confirmation',
    )
  })

  it('withholds the gap list from an unauthenticated caller', async () => {
    // An uptime monitor still gets the 503 it needs to page on, without the
    // endpoint publishing table, column and migration names to the internet.
    const res = await app.request('/v1/health/ready')
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.schema).toBe('drift')
    expect(body.gaps).toEqual([])
  })

  it('rejects a wrong API key for the detail', async () => {
    const res = await app.request('/v1/health/ready', {
      headers: { 'x-api-key': 'not-the-key' },
    })
    const body = await res.json()
    expect(body.gaps).toEqual([])
  })

  it('liveness still answers 200 — the process is fine, the schema is not', async () => {
    const res = await app.request('/v1/health')
    expect(res.status).toBe(200)
  })
})
