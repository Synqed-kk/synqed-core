import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'
import { prisma } from '../src/db/client.js'
import {
  checkSchemaContract,
  SCHEMA_CONTRACT,
  type SchemaContract,
} from '../src/db/schema-contract.js'
import { testPrisma, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY

describe('schema contract — against the real database', () => {
  it('every entry in the shipped contract really exists', async () => {
    // Guards the contract itself. A typo'd table or constraint name would make
    // the readiness probe cry drift forever, get muted, and leave the next
    // real drift invisible — the failure mode the probe exists to prevent.
    const gaps = await checkSchemaContract()
    expect(gaps).toEqual([])
  })

  it('the contract is not vacuous', () => {
    const total =
      SCHEMA_CONTRACT.enumValues.length +
      SCHEMA_CONTRACT.columns.length +
      SCHEMA_CONTRACT.constraints.length
    expect(total).toBeGreaterThan(0)
  })

  it('covers the four migrations that caused the 2026-09-04 outage', () => {
    const covered = new Set(
      [
        ...SCHEMA_CONTRACT.enumValues,
        ...SCHEMA_CONTRACT.columns,
        ...SCHEMA_CONTRACT.constraints,
      ].map((r) => r.migration),
    )
    expect(covered).toContain('2026-09-01-karute-discarded-status')
    expect(covered).toContain('2026-09-02-recording-discard-karute-key')
    expect(covered).toContain('2026-09-03-recording-discard-confirmation')
    expect(covered).toContain('2026-09-03-transcription-segment-unique')
  })
})

describe('schema contract — detects drift', () => {
  it('reports a missing enum value, column and constraint', async () => {
    // Exactly the SHAPE of the outage: an unapplied migration.
    const drifted: SchemaContract = {
      enumValues: [
        { type: 'KaruteStatus', value: 'NEVER_ADDED', migration: 'pending-enum' },
      ],
      columns: [
        {
          table: 'recording_discard_events',
          column: 'never_added_column',
          migration: 'pending-column',
        },
      ],
      constraints: [
        {
          table: 'recording_discard_events',
          name: 'never_added_constraint',
          migration: 'pending-constraint',
        },
      ],
    }

    const gaps = await checkSchemaContract(drifted)

    expect(gaps).toHaveLength(3)
    expect(gaps).toContainEqual({
      kind: 'enum_value',
      subject: 'KaruteStatus.NEVER_ADDED',
      migration: 'pending-enum',
    })
    expect(gaps).toContainEqual({
      kind: 'column',
      subject: 'recording_discard_events.never_added_column',
      migration: 'pending-column',
    })
    expect(gaps).toContainEqual({
      kind: 'constraint',
      subject: 'recording_discard_events.never_added_constraint',
      migration: 'pending-constraint',
    })
  })

  it('reports EVERY gap, not just the first', async () => {
    // An operator applying migrations at 3am needs the whole list in one line.
    const drifted: SchemaContract = {
      enumValues: [],
      columns: [
        { table: 'recording_discard_events', column: 'missing_a', migration: 'm' },
        { table: 'recording_discard_events', column: 'missing_b', migration: 'm' },
        { table: 'recording_discard_events', column: 'missing_c', migration: 'm' },
      ],
      constraints: [],
    }

    const gaps = await checkSchemaContract(drifted)
    expect(gaps.map((g) => g.subject)).toEqual([
      'recording_discard_events.missing_a',
      'recording_discard_events.missing_b',
      'recording_discard_events.missing_c',
    ])
  })

  it('accepts an injected client', async () => {
    const gaps = await checkSchemaContract(SCHEMA_CONTRACT, testPrisma)
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

  it('actually queries the database, unlike the old /health', async () => {
    // The old endpoint was `c.json({status:'ok'})` — a constant. It answered
    // 200 through the entire outage. Proving readiness touches the DB is the
    // point of the whole change, so assert the call directly rather than
    // reading pg_stat_database, whose collector updates asynchronously.
    const spy = vi.spyOn(prisma, '$queryRaw')
    try {
      await app.request('/v1/health/ready')
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('reports degraded when the database is unreachable', async () => {
    // Liveness stays 200 (the process is fine); readiness must not.
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValue(
        Object.assign(new Error("Can't reach database server"), {
          code: 'P1001',
        }),
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
})
