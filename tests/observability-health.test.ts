import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index.js'
import { prisma } from '../src/db/client.js'
import {
  checkSchemaContract,
  derivedRequirements,
  CONSTRAINT_CONTRACT,
  MIGRATION_HINTS,
  type DerivedRequirements,
} from '../src/db/schema-contract.js'
import { resetReadinessCache } from '../src/routes/health.js'
import { testPrisma, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY

beforeEach(() => {
  // The endpoint memoizes its verdict for a few seconds; a test must observe
  // its own request, not the previous one's answer.
  resetReadinessCache()
})

describe('schema contract — against the real database', () => {
  it('the whole derived contract is satisfied by a migrated database', async () => {
    // Every table, column and enum value Prisma knows about. A gap here means
    // either the database is behind the schema or the derivation is wrong;
    // both must fail CI rather than production.
    const gaps = await checkSchemaContract()
    expect(gaps).toEqual([])
  })

  it('derives the whole datamodel, not a curated subset', () => {
    // The point of deriving: a hand-listed contract silently under-covers and
    // then reports healthy while the routes it forgot fail at runtime.
    const req = derivedRequirements()
    expect(req.tables.size).toBeGreaterThan(40)
    expect(req.enums.size).toBeGreaterThan(15)
  })

  it('covers the objects behind the 2026-09-04 outage', () => {
    const req = derivedRequirements()
    expect(req.enums.get('KaruteStatus')).toContain('DISCARDED')

    const discard = req.tables.get('recording_discard_events')
    expect(discard).toContain('karute_record_id')
    expect(discard).toContain('confirmed_by')
    expect(discard).toContain('confirmed_at')
  })

  it('covers retention_signals, which no hand-written list included', () => {
    // 2026-08-20-retention-signals.sql is one of 48 manual migrations. The
    // derived contract picks it up without anyone remembering to.
    const req = derivedRequirements()
    expect(req.tables.has('retention_signals')).toBe(true)
    expect(req.enums.has('RetentionSignalStatus')).toBe(true)
  })

  it('maps model and field names to their database names', () => {
    const req = derivedRequirements()
    // RecordingDiscardEvent -> recording_discard_events, businessId -> business_id
    expect(req.tables.has('recording_discard_events')).toBe(true)
    expect(req.tables.get('recording_discard_events')).toContain('business_id')
    expect(req.tables.get('recording_discard_events')).not.toContain('businessId')
  })

  it('excludes relation fields, which are not columns', () => {
    const req = derivedRequirements()
    for (const columns of req.tables.values()) {
      expect(columns).not.toContain('business')
      expect(columns).not.toContain('karuteRecord')
    }
  })

  it('declares the constraints the DMMF cannot see', () => {
    const names = CONSTRAINT_CONTRACT.map((c) => c.name)
    expect(names).toContain('rde_has_subject')
    expect(names).toContain('rde_confirmation_pair')
  })
})

describe('schema contract — detects drift', () => {
  it('reports a missing column', async () => {
    const req = derivedRequirements()
    req.tables.set('recording_discard_events', [
      ...req.tables.get('recording_discard_events')!,
      'never_added_column',
    ])

    const gaps = await checkSchemaContract(req)
    expect(gaps).toContainEqual({
      kind: 'column',
      subject: 'recording_discard_events.never_added_column',
    })
  })

  it('reports a missing enum value', async () => {
    const req = derivedRequirements()
    req.enums.set('KaruteStatus', [...req.enums.get('KaruteStatus')!, 'NEVER_ADDED'])

    const gaps = await checkSchemaContract(req)
    expect(gaps).toContainEqual({
      kind: 'enum_value',
      subject: 'KaruteStatus.NEVER_ADDED',
    })
  })

  it('names the migration for a hinted object, so recovery matches the runbook', async () => {
    // The runbook tells an operator to apply the files in gaps[].migration.
    // Deriving the contract must not cost that attribution.
    const gaps = await checkSchemaContract(
      { tables: new Map([['never_created_table', []]]), enums: new Map() },
      [],
      testPrisma,
      { never_created_table: '2026-01-01-some-migration' },
    )

    expect(gaps).toEqual([
      {
        kind: 'table',
        subject: 'never_created_table',
        migration: '2026-01-01-some-migration',
      },
    ])
  })

  it('still reports an UNHINTED gap, just without a filename', async () => {
    // Attribution is best-effort; detection is not. A missing hint must cost
    // a grep, never the alert.
    const gaps = await checkSchemaContract(
      { tables: new Map([['never_created_table', []]]), enums: new Map() },
      [],
      testPrisma,
      {},
    )

    expect(gaps).toEqual([{ kind: 'table', subject: 'never_created_table' }])
  })

  it('hints the objects behind the 2026-09-04 outage', () => {
    expect(MIGRATION_HINTS['KaruteStatus.DISCARDED']).toBe(
      '2026-09-01-karute-discarded-status',
    )
    expect(MIGRATION_HINTS['recording_discard_events.confirmed_by']).toBe(
      '2026-09-03-recording-discard-confirmation',
    )
    expect(MIGRATION_HINTS['retention_signals']).toBe(
      '2026-08-20-retention-signals',
    )
  })

  it('reports a missing table ONCE, not once per column', async () => {
    // A missing table with forty columns must not bury the one line an
    // operator needs.
    const req: DerivedRequirements = {
      tables: new Map([['never_created_table', ['a', 'b', 'c', 'd']]]),
      enums: new Map(),
    }

    const gaps = await checkSchemaContract(req, [])
    expect(gaps).toEqual([{ kind: 'table', subject: 'never_created_table' }])
  })

  it('reports a missing enum type once', async () => {
    const req: DerivedRequirements = {
      tables: new Map(),
      enums: new Map([['NeverCreatedEnum', ['A', 'B']]]),
    }

    const gaps = await checkSchemaContract(req, [])
    expect(gaps).toEqual([{ kind: 'enum', subject: 'NeverCreatedEnum' }])
  })

  it('reports a missing constraint and names its migration', async () => {
    const gaps = await checkSchemaContract(
      { tables: new Map(), enums: new Map() },
      [{ table: 'recording_discard_events', name: 'never_added', migration: 'pending-file' }],
    )
    expect(gaps).toEqual([
      {
        kind: 'constraint',
        subject: 'recording_discard_events.never_added',
        migration: 'pending-file',
      },
    ])
  })

  it('reports EVERY gap, not just the first', async () => {
    const req: DerivedRequirements = {
      tables: new Map([['recording_discard_events', ['missing_a', 'missing_b', 'missing_c']]]),
      enums: new Map(),
    }

    const gaps = await checkSchemaContract(req, [])
    expect(gaps.map((g) => g.subject)).toEqual([
      'recording_discard_events.missing_a',
      'recording_discard_events.missing_b',
      'recording_discard_events.missing_c',
    ])
  })

  it('accepts an injected client', async () => {
    const gaps = await checkSchemaContract(
      derivedRequirements(),
      CONSTRAINT_CONTRACT,
      testPrisma,
    )
    expect(gaps).toEqual([])
  })
})

describe('GET /v1/health — liveness', () => {
  it('answers 200 without an API key', async () => {
    const res = await app.request('/v1/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.check).toBe('liveness')
  })

  it('points at the deep check, so nobody monitors liveness by mistake', async () => {
    const res = await app.request('/v1/health')
    const body = await res.json()
    expect(body.deep).toBe('/v1/health/ready')
  })
})

describe('GET /v1/health/ready — readiness', () => {
  it('is reachable without an API key so an uptime monitor can page on it', async () => {
    const res = await app.request('/v1/health/ready')
    // The pre-fix auth exemption was /\/health$/, which did not match this
    // path — an unauthenticated monitor got 401, not the health verdict.
    expect(res.status).not.toBe(401)
  })

  it('answers 200 with schema ok against a migrated database', async () => {
    const res = await app.request('/v1/health/ready')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.database).toBe('ok')
    expect(body.schema).toBe('ok')
    expect(body.gaps).toEqual([])
    expect(typeof body.checked_at).toBe('string')
  })

  it('reports the release it is serving, so a post-deploy probe can wait for it', async () => {
    const res = await app.request('/v1/health/ready')
    const body = await res.json()
    // Null locally; VERCEL_GIT_COMMIT_SHA in a real deploy. The monitor
    // compares this against the pushed commit before trusting a 200.
    expect(body).toHaveProperty('release')
  })

  it('actually queries the database, unlike the old /health', async () => {
    // The old endpoint was `c.json({status:'ok'})` — a constant. It answered
    // 200 through the entire outage.
    const spy = vi.spyOn(prisma, '$queryRaw')
    try {
      await app.request('/v1/health/ready')
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('reports degraded when the database is unreachable', async () => {
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValue(
        Object.assign(new Error("Can't reach database server"), { code: 'P1001' }),
      )
    try {
      const res = await app.request('/v1/health/ready')
      expect(res.status).toBe(503)

      const body = await res.json()
      expect(body.status).toBe('degraded')
      expect(body.database).toBe('unreachable')
      expect(body.schema).toBe('unknown')
    } finally {
      spy.mockRestore()
    }
  })

  it('memoizes briefly so a public endpoint cannot amplify database load', async () => {
    // Unauthenticated and four queries per miss; without a bound, public
    // traffic would contend with real requests for connections.
    await app.request('/v1/health/ready')

    const spy = vi.spyOn(prisma, '$queryRaw')
    try {
      await app.request('/v1/health/ready')
      await app.request('/v1/health/ready')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
