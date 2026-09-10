/** Error normalization — turn a thrown value into alertable FIELDS.
 *
 *  The 2026-09-04 outage threw two distinct database errors for five hours:
 *  Postgres 22P02 (`invalid input value for enum "KaruteStatus": "DISCARDED"`)
 *  on every list read, and Prisma P2022 (missing column) on the discard
 *  ledger. Both were logged as an opaque string. Neither could be counted.
 *
 *  `kind` is the field worth paging on: `schema_drift` means the deployed code
 *  expects a database shape that production does not have — the exact failure
 *  that took Karute down. */

export type ErrorKind =
  | 'schema_drift'
  | 'db_unreachable'
  | 'validation'
  | 'unknown'

export interface NormalizedError {
  kind: ErrorKind
  message: string
  /** Prisma's own code, e.g. P2022. Null when the throw was not from Prisma. */
  prisma_code: string | null
  /** Postgres SQLSTATE, e.g. 22P02, when Prisma surfaced it. */
  pg_code: string | null
}

function read(e: unknown, key: string): unknown {
  if (e === null || typeof e !== 'object') return undefined
  return (e as Record<string, unknown>)[key]
}

/** Prisma codes that mean "the schema is not what the code compiled against".
 *  P2021 = table does not exist. P2022 = column does not exist. */
const DRIFT_PRISMA_CODES = new Set(['P2021', 'P2022'])

/** Postgres SQLSTATEs for a missing object. */
const DRIFT_PG_CODES = new Set([
  '42P01', // undefined_table
  '42703', // undefined_column
  '42704', // undefined_object (a type/enum that isn't there)
])

/** Postgres SQLSTATEs that mean the database could not be reached or was
 *  shutting down — a different page, and a different fix, from drift. */
const UNREACHABLE_PG_CODES = new Set([
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
])

/** Prisma connection-layer codes. P1001 unreachable, P1002 timeout,
 *  P1008 operation timed out, P1017 server closed the connection. */
const UNREACHABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017'])

/** Pull a SQLSTATE out of wherever Prisma parked it. Driver adapters put it on
 *  `.code`; the query engine puts it in `.meta.code`; some paths only leave it
 *  in the message text. */
function extractPgCode(e: unknown, message: string): string | null {
  const meta = read(e, 'meta')
  const metaCode = meta && typeof meta === 'object'
    ? (meta as Record<string, unknown>).code
    : undefined
  if (typeof metaCode === 'string' && /^[0-9A-Z]{5}$/.test(metaCode)) {
    return metaCode
  }

  const own = read(e, 'code')
  // Prisma's own codes start with P; a bare 5-char SQLSTATE is Postgres'.
  if (typeof own === 'string' && /^[0-9]{2}[0-9A-Z]{3}$/.test(own)) return own

  const fromMessage = message.match(/\b(?:SQLSTATE|code:?)\s*\(?([0-9]{2}[0-9A-Z]{3})\)?/)
  return fromMessage ? fromMessage[1] : null
}

export function normalizeError(e: unknown): NormalizedError {
  const message = e instanceof Error ? e.message : String(e)

  const rawPrisma = read(e, 'code')
  const prisma_code =
    typeof rawPrisma === 'string' && /^P\d{4}$/.test(rawPrisma)
      ? rawPrisma
      : null

  const pg_code = extractPgCode(e, message)

  // A missing enum VALUE reports as 22P02 (invalid_text_representation) — the
  // same SQLSTATE a malformed UUID produces. Only the enum wording is drift;
  // a bad UUID from a caller is ordinary validation. This distinction is the
  // whole reason we match the message here and not the code alone.
  const isMissingEnumValue =
    pg_code === '22P02' && /invalid input value for enum/i.test(message)

  let kind: ErrorKind = 'unknown'
  if (
    (prisma_code && DRIFT_PRISMA_CODES.has(prisma_code)) ||
    (pg_code && DRIFT_PG_CODES.has(pg_code)) ||
    isMissingEnumValue
  ) {
    kind = 'schema_drift'
  } else if (
    (prisma_code && UNREACHABLE_PRISMA_CODES.has(prisma_code)) ||
    (pg_code && UNREACHABLE_PG_CODES.has(pg_code))
  ) {
    kind = 'db_unreachable'
  } else if (pg_code === '22P02' || prisma_code === 'P2000') {
    kind = 'validation'
  }

  return { kind, message, prisma_code, pg_code }
}
