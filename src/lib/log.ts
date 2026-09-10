/** Structured JSON logging for core.
 *
 *  One line per event, JSON.stringify'd to the console, so a log drain can
 *  group and alert on FIELDS rather than grep a prose string. The field names
 *  deliberately match Karute's audit emitter (`at`, `request_id`,
 *  `business_id`, `severity`) so both halves of the stack land in one drain
 *  with one schema.
 *
 *  Why this exists: the 2026-09-04 outage logged every failure as
 *  `console.error('[synqed-core] unhandled error:', err)`. That line drops the
 *  Prisma code, the Postgres code, the route and the business, so the 5xx
 *  spike could not be grouped, counted, or alerted on. Nobody was paged; a
 *  human found it four hours later. */

export type Severity = 'info' | 'warning' | 'error'

/** Fields every line carries. Anything else rides in `detail`. */
export interface LogFields {
  evt: string
  severity?: Severity
  request_id?: string | null
  business_id?: string | null
  detail?: Record<string, unknown> | null
}

/** Never throws. A logger that can fail is a logger that takes the process
 *  down during the incident it exists to report. */
export function log(fields: LogFields): void {
  try {
    const severity = fields.severity ?? 'info'
    const line = JSON.stringify({
      at: new Date().toISOString(),
      severity,
      ...fields,
      request_id: fields.request_id ?? null,
      business_id: fields.business_id ?? null,
      detail: fields.detail ?? null,
    })
    if (severity === 'error') console.error(line)
    else if (severity === 'warning') console.warn(line)
    else console.log(line)
  } catch {
    // A payload that cannot serialize (a cycle, a BigInt) must not escalate
    // into a crash. Drop the detail and keep the signal.
    try {
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          evt: fields.evt,
          severity: 'error',
          detail: { log_serialize_failed: true },
        }),
      )
    } catch {
      /* give up quietly */
    }
  }
}
