import { describe, it, expect } from 'vitest'
import { normalizeError } from '../src/lib/errors.js'

/** These are the two errors production actually threw for five hours on
 *  2026-09-04. If `kind` stops coming back as `schema_drift` for them, the
 *  alerting rule that exists to catch that outage stops firing. */
describe('normalizeError — the 2026-09-04 errors', () => {
  it('classifies the missing KaruteStatus enum value as schema_drift', () => {
    // What Postgres returned on every Karute list read.
    const e = Object.assign(
      new Error(
        'invalid input value for enum "KaruteStatus": "DISCARDED"',
      ),
      { code: '22P02' },
    )

    const n = normalizeError(e)
    expect(n.kind).toBe('schema_drift')
    expect(n.pg_code).toBe('22P02')
  })

  it('classifies a Prisma P2022 missing column as schema_drift', () => {
    // What the discard ledger returned.
    const e = Object.assign(
      new Error('The column `confirmed_by` does not exist in the current database.'),
      { code: 'P2022' },
    )

    const n = normalizeError(e)
    expect(n.kind).toBe('schema_drift')
    expect(n.prisma_code).toBe('P2022')
  })
})

describe('normalizeError — does not over-classify', () => {
  it('treats a malformed UUID as validation, NOT schema drift', () => {
    // Same 22P02 SQLSTATE as the enum failure. A caller sending a bad UUID
    // must never page an operator about migrations; if this regresses, the
    // schema-drift alert becomes noise and gets muted.
    const e = Object.assign(
      new Error('invalid input syntax for type uuid: "not-a-uuid"'),
      { code: '22P02' },
    )

    const n = normalizeError(e)
    expect(n.kind).toBe('validation')
    expect(n.pg_code).toBe('22P02')
  })

  it('classifies an unreachable database separately from drift', () => {
    const e = Object.assign(new Error("Can't reach database server"), {
      code: 'P1001',
    })

    const n = normalizeError(e)
    expect(n.kind).toBe('db_unreachable')
    expect(n.prisma_code).toBe('P1001')
  })

  it('leaves an ordinary error unknown and keeps its message', () => {
    const n = normalizeError(new Error('something ordinary broke'))
    expect(n.kind).toBe('unknown')
    expect(n.prisma_code).toBeNull()
    expect(n.pg_code).toBeNull()
    expect(n.message).toBe('something ordinary broke')
  })

  it('survives a non-Error throw', () => {
    const n = normalizeError('a bare string')
    expect(n.kind).toBe('unknown')
    expect(n.message).toBe('a bare string')
  })
})

describe('normalizeError — SQLSTATE extraction', () => {
  it('reads the code out of Prisma meta', () => {
    const e = Object.assign(new Error('undefined column'), {
      code: 'P2010',
      meta: { code: '42703' },
    })

    const n = normalizeError(e)
    expect(n.pg_code).toBe('42703')
    expect(n.kind).toBe('schema_drift')
  })

  it('falls back to the message text when no code field carries it', () => {
    const n = normalizeError(
      new Error('db error: relation "widgets" does not exist (SQLSTATE 42P01)'),
    )
    expect(n.pg_code).toBe('42P01')
    expect(n.kind).toBe('schema_drift')
  })
})
