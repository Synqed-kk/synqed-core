# CORE-4: permanent staff identity

New Karute records accept a permanent staff-card UUID or a login UUID. Both must
resolve to exactly one card in the caller's business. Missing, foreign-business,
and ambiguous identities return HTTP 400 without creating records or entries.
Inactive cards remain valid for delayed historical writes. This normalizes
ownership; it does not replace human-actor authorization or implement coaching
consent and grants. Business-key callers retain their existing write authority.

## Historical repair

With DATABASE_URL set to the intended environment, preview one business:

```sh
npx tsx scripts/normalize-karute-staff.ts <business-uuid>
```

The report counts all rows, proposed changes, missing mappings and ambiguous
mappings, and includes the first 100 blocking record IDs. It contains no chart
content. Resolve blocking identities from authoritative staff history; never
assign an unknown record to a convenient current staff member.

After reviewing the preview, run the same command with `--apply`. The operation
recomputes its mapping under locks and refuses the entire repair if any record
is unresolved or ambiguous. Every changed record receives an audit entry with
its previous and permanent staff IDs. Chart content, entry links, recording
links and timestamps are preserved. Repeating the repair changes zero records
and creates no extra audits.

Run during a maintenance window: both preview and apply briefly lock staff and
Karute writes across businesses to stabilize the identity namespace. Lock wait
is bounded at five seconds and each statement at thirty seconds. A timeout or
audit failure rolls the transaction back; investigate before retrying.

Deploy the write normalization before repairing historical records. This PR
does not assert that any production repair has run. The existing audit-log
schema must be installed. No new Prisma schema or automatic migration is added.
