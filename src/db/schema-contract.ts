/** Does production really have the schema this build was compiled against?
 *
 *  On 2026-09-04 four manual migrations were unapplied when code that needed
 *  them went live, and every record read failed for five hours. The migration
 *  gate blocks a MERGE on a human attestation; as the incident write-up says,
 *  that label "does not query production". This is the half that does.
 *
 *  Tables, columns and enum values are DERIVED from the Prisma schema rather
 *  than hand-listed. A curated list is only as good as the last person who
 *  remembered to update it, and a contract that silently under-covers is worse
 *  than none: it reports healthy while the routes it forgot fail at runtime.
 *  Deriving means every model Prisma knows about is checked, automatically,
 *  forever.
 *
 *  CHECK and UNIQUE constraints are the exception — Prisma's DMMF does not
 *  model them, so those stay hand-declared below. */

import { Prisma } from '@prisma/client'
import { prisma } from './client.js'

/** Constraints added by manual SQL that the DMMF cannot tell us about.
 *  Add an entry when a manual migration adds one the code relies on. */
export interface ConstraintRequirement {
  table: string
  name: string
  migration: string
}

/** Best-effort attribution: which manual migration adds a given object.
 *
 *  This is a HINT, never the coverage mechanism. Detection comes from the
 *  derived contract, so an object missing from this map is still reported as a
 *  gap — it just arrives without a filename. That split is deliberate: the
 *  thing that must never silently under-cover is derived, and the thing that
 *  only saves an operator a `grep` is allowed to be incomplete.
 *
 *  Keyed by the same `subject` string the gap carries. */
export const MIGRATION_HINTS: Record<string, string> = {
  // The four behind the 2026-09-04 outage.
  'KaruteStatus.DISCARDED': '2026-09-01-karute-discarded-status',
  'recording_discard_events.karute_record_id':
    '2026-09-02-recording-discard-karute-key',
  'recording_discard_events.confirmed_by':
    '2026-09-03-recording-discard-confirmation',
  'recording_discard_events.confirmed_at':
    '2026-09-03-recording-discard-confirmation',
  // Recent manual migrations whose tables the code reads.
  recording_discard_events: '2026-08-17-recording-discard-events',
  retention_signals: '2026-08-20-retention-signals',
  RetentionSignalStatus: '2026-08-20-retention-signals',
  staff_permissions: '2026-08-21-staff-permissions',
  idempotency_keys: '2026-07-28-idempotency-keys',
  recording_jobs: '2026-07-20-recording-jobs',
  ai_cache: '2026-06-25-ai-cache',
  'recording_jobs.terminal_reason': '2026-09-11-recording-job-terminal-failure',
  RecordingLifecycleState: '2026-09-11-recording-session-lifecycle',
  'recording_sessions.lifecycle_state': '2026-09-11-recording-session-lifecycle',
  'recording_sessions.client_version': '2026-09-11-recording-session-lifecycle',
  'recording_sessions.platform': '2026-09-11-recording-session-lifecycle',
  'recording_sessions.audio_mime': '2026-09-11-recording-session-lifecycle',
  'recording_sessions.sample_rate_hz': '2026-09-11-recording-session-lifecycle',
  'recording_sessions.audio_route': '2026-09-11-recording-session-lifecycle',
}

export const CONSTRAINT_CONTRACT: ConstraintRequirement[] = [
  {
    table: 'recording_discard_events',
    name: 'rde_has_subject',
    migration: '2026-09-02-recording-discard-karute-key',
  },
  {
    table: 'recording_discard_events',
    name: 'rde_confirmation_pair',
    migration: '2026-09-03-recording-discard-confirmation',
  },
  {
    table: 'transcription_segments',
    name: 'transcription_segments_recording_session_id_segment_index_key',
    migration: '2026-09-03-transcription-segment-unique',
  },
]

/** One missing piece of schema, named well enough to fix without digging. */
export interface SchemaGap {
  kind: 'table' | 'column' | 'enum' | 'enum_value' | 'constraint'
  /** e.g. `KaruteStatus.DISCARDED` or `recording_discard_events.confirmed_by` */
  subject: string
  /** The manual migration that adds it, when we can name one. */
  migration?: string
}

/** What the Prisma schema says the database must contain. */
export interface DerivedRequirements {
  tables: Map<string, string[]>
  enums: Map<string, string[]>
}

export function derivedRequirements(): DerivedRequirements {
  const tables = new Map<string, string[]>()
  for (const model of Prisma.dmmf.datamodel.models) {
    const table = model.dbName ?? model.name
    const columns = model.fields
      // Relations are not columns. Scalars and enums are.
      .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
      .map((f) => f.dbName ?? f.name)
    tables.set(table, columns)
  }

  const enums = new Map<string, string[]>()
  for (const e of Prisma.dmmf.datamodel.enums) {
    enums.set(
      e.dbName ?? e.name,
      e.values.map((v) => v.dbName ?? v.name),
    )
  }

  return { tables, enums }
}

/** Ask the LIVE database whether the contract holds. Returns every gap, not
 *  just the first — an operator applying migrations at 3am wants the whole
 *  list in one line, not one per restart.
 *
 *  Every catalog query is scoped to `current_schema()`. Supabase databases
 *  carry auth/storage/extensions schemas alongside the application's, and an
 *  identically named enum or constraint in one of those would otherwise
 *  satisfy the contract while the object we actually need is missing. */
export async function checkSchemaContract(
  requirements: DerivedRequirements = derivedRequirements(),
  constraints: ConstraintRequirement[] = CONSTRAINT_CONTRACT,
  client: typeof prisma = prisma,
  hints: Record<string, string> = MIGRATION_HINTS,
): Promise<SchemaGap[]> {
  const gaps: SchemaGap[] = []

  const [enumRows, columnRows, constraintRows] = await Promise.all([
    client.$queryRaw<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = current_schema()
    `,
    client.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `,
    client.$queryRaw<{ conname: string; relname: string }[]>`
      SELECT c.conname, r.relname
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = current_schema()
    `,
  ])

  const liveColumns = new Map<string, Set<string>>()
  for (const r of columnRows) {
    let set = liveColumns.get(r.table_name)
    if (!set) liveColumns.set(r.table_name, (set = new Set()))
    set.add(r.column_name)
  }

  const liveEnums = new Map<string, Set<string>>()
  for (const r of enumRows) {
    let set = liveEnums.get(r.typname)
    if (!set) liveEnums.set(r.typname, (set = new Set()))
    set.add(r.enumlabel)
  }

  const liveConstraints = new Set(
    constraintRows.map((r) => `${r.relname}.${r.conname}`),
  )

  const gap = (kind: SchemaGap['kind'], subject: string): SchemaGap => {
    const migration = hints[subject]
    return migration ? { kind, subject, migration } : { kind, subject }
  }

  for (const [table, columns] of requirements.tables) {
    const live = liveColumns.get(table)
    // A missing TABLE is reported once. Listing each of its forty columns
    // would bury the one line an operator needs.
    if (!live) {
      gaps.push(gap('table', table))
      continue
    }
    for (const column of columns) {
      if (!live.has(column)) {
        gaps.push(gap('column', `${table}.${column}`))
      }
    }
  }

  for (const [type, values] of requirements.enums) {
    const live = liveEnums.get(type)
    if (!live) {
      gaps.push(gap('enum', type))
      continue
    }
    for (const value of values) {
      if (!live.has(value)) {
        gaps.push(gap('enum_value', `${type}.${value}`))
      }
    }
  }

  for (const r of constraints) {
    if (!liveConstraints.has(`${r.table}.${r.name}`)) {
      gaps.push({
        kind: 'constraint',
        subject: `${r.table}.${r.name}`,
        migration: r.migration,
      })
    }
  }

  return gaps
}
