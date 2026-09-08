# CORE-7: double-burn protection and July corrections

The partial unique index already exists in the migration dated 2026-07-28, which
records production application that day. Verify the intended database before
calling the live guard complete:

```sql
SELECT i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid)
FROM pg_index i
WHERE i.indexrelid = to_regclass('pack_redemptions_active_appointment_unique');
SELECT appointment_id, count(*) FROM pack_redemptions
WHERE removed_at IS NULL AND appointment_id IS NOT NULL
GROUP BY appointment_id HAVING count(*) > 1;
```

The index must be valid and unique, cover appointment_id and exclude removed
rows; the second query must return zero rows. Do not test live uniqueness by
charging a real customer. Integration tests exercise concurrent inserts locally.

The appointment update service already clears status_reason when restoring a
cancelled booking without a new reason. No-show count is **derived** from current
NO_SHOW appointments by customerEnrichment; there is no customer counter column
to decrement. Correcting the appointment reduces the next enrichment result.

## Exact-record repair

Obtain Liam's confirmed July 9–10, 2026 appointment IDs and the target business
UUID. Being a July no-show is not proof that the customer contacted the salon.
Build a private JSON manifest from the current database snapshot:

```json
{
  "business_id": "<exact business UUID>",
  "evidence": "<link or reference to the confirmed correction list>",
  "appointments": [{
    "appointment_id": "<exact appointment UUID>",
    "customer_id": "<exact customer UUID>",
    "starts_at": "2026-07-09T03:00:00.000Z",
    "updated_at": "<current ISO timestamp>",
    "status_reason": null
  }]
}
```

Keep customer data and credentials out of the repository. With DATABASE_URL set
to the intended environment, preview with:

```sh
npx tsx scripts/repair-july-cancellations.ts /secure/path/manifest.json
```

After reviewing IDs and projected no-show counts, add `--apply`. The command
locks the named bookings in order, validates every business/customer/date/version
and original reason, then changes the whole batch atomically. Any mismatch
refuses the batch. It stamps CANCELLED + cancel-same-day-contact, preserves an
existing cancellation timestamp, adds status history and an audit of previous
values, and uses STAFF status source to preserve the correction against sync.
It does not alter pack redemptions or monetary balances.

Keep the exact manifest for reruns: matching audit fingerprints acknowledge
already-applied rows without duplicate history or audit entries. A modified or
stale manifest requires a fresh investigation, not an override. Counts in the
report are a point-in-time projection; unrelated appointments can change them.
Verify corrected rows and fresh customer enrichment after application, and
allow Karute's enrichment cache to refresh before checking its badge.

This PR prepares and locally verifies the repair. Exact production targets and
production database access are still required; no live repair is claimed.
