/** The schema this build requires production to already have.
 *
 *  Prisma's own migrations are applied by the deploy. The entries below come
 *  from `prisma/migrations/manual/` — SQL a human runs by hand, which is
 *  exactly the set that can be missing when code goes live. On 2026-09-04 all
 *  four September files were unapplied at deploy time and every record read
 *  failed for five hours.
 *
 *  The migration gate (PR #82/#98) blocks the MERGE on a human attestation.
 *  As the incident write-up says, that label "does not query production".
 *  This contract is the half that does: `checkSchemaContract` asks the live
 *  database whether each item is really there.
 *
 *  Add an entry here whenever a manual migration adds an enum value, a column,
 *  or a constraint the code reads. */

import { prisma } from './client.js'

export interface EnumValueRequirement {
  type: string
  value: string
  migration: string
}

export interface ColumnRequirement {
  table: string
  column: string
  migration: string
}

export interface ConstraintRequirement {
  table: string
  name: string
  migration: string
}

export interface SchemaContract {
  enumValues: EnumValueRequirement[]
  columns: ColumnRequirement[]
  constraints: ConstraintRequirement[]
}

export const SCHEMA_CONTRACT: SchemaContract = {
  enumValues: [
    // The 22P02 that took every Karute list read down.
    {
      type: 'KaruteStatus',
      value: 'DISCARDED',
      migration: '2026-09-01-karute-discarded-status',
    },
  ],
  columns: [
    // The P2022s on the discard ledger.
    {
      table: 'recording_discard_events',
      column: 'karute_record_id',
      migration: '2026-09-02-recording-discard-karute-key',
    },
    {
      table: 'recording_discard_events',
      column: 'confirmed_by',
      migration: '2026-09-03-recording-discard-confirmation',
    },
    {
      table: 'recording_discard_events',
      column: 'confirmed_at',
      migration: '2026-09-03-recording-discard-confirmation',
    },
  ],
  constraints: [
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
  ],
}

/** One missing piece of schema, named well enough to fix without digging. */
export interface SchemaGap {
  kind: 'enum_value' | 'column' | 'constraint'
  /** e.g. `KaruteStatus.DISCARDED` or `recording_discard_events.confirmed_by` */
  subject: string
  /** The manual migration file that would add it. */
  migration: string
}

/** Ask the LIVE database whether the contract holds. Returns every gap, not
 *  just the first — an operator applying migrations at 3am wants the whole
 *  list in one line, not one per restart. */
export async function checkSchemaContract(
  contract: SchemaContract = SCHEMA_CONTRACT,
  client: typeof prisma = prisma,
): Promise<SchemaGap[]> {
  const gaps: SchemaGap[] = []

  const [enumRows, columnRows, constraintRows] = await Promise.all([
    client.$queryRaw<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
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
    `,
  ])

  const haveEnum = new Set(
    enumRows.map((r) => `${r.typname}.${r.enumlabel}`),
  )
  const haveColumn = new Set(
    columnRows.map((r) => `${r.table_name}.${r.column_name}`),
  )
  const haveConstraint = new Set(
    constraintRows.map((r) => `${r.relname}.${r.conname}`),
  )

  for (const r of contract.enumValues) {
    if (!haveEnum.has(`${r.type}.${r.value}`)) {
      gaps.push({
        kind: 'enum_value',
        subject: `${r.type}.${r.value}`,
        migration: r.migration,
      })
    }
  }
  for (const r of contract.columns) {
    if (!haveColumn.has(`${r.table}.${r.column}`)) {
      gaps.push({
        kind: 'column',
        subject: `${r.table}.${r.column}`,
        migration: r.migration,
      })
    }
  }
  for (const r of contract.constraints) {
    if (!haveConstraint.has(`${r.table}.${r.name}`)) {
      gaps.push({
        kind: 'constraint',
        subject: `${r.table}.${r.name}`,
        migration: r.migration,
      })
    }
  }

  return gaps
}
