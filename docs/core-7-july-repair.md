# CORE-7: burn and restore verification

Liam's September 9 correction on CORE-7 supersedes the original July relabel
request. His read-only live query found zero NO_SHOW appointments on July 9–10
or any other date in Core. The business had 2,640 SCHEDULED and 183 CANCELLED
appointments, no NO_SHOW history/audit trace, and no persisted no-show counter.
The proposed July status-repair command has therefore been removed.

Four already-cancelled appointments are candidates for a reason-only correction:

- 16a2d0d6-f1e3-4019-891f-5a3943bb7d85
- 70e314fd-1c35-4bcd-942a-85cdb5670295
- 7631b003-8b79-420d-a1f5-a1178646ddb1
- d88b4812-ec96-4e7e-9796-9829877954c3

Same-day cancellation timestamps alone do not establish customer contact. Liam
must confirm which candidates qualify before a manual migration changes their
reason to cancel-same-day-contact. Do not change their status or invent a
counter decrement. Core's enrichment derives no-show counts from NO_SHOW rows.

## Existing guards

The 2026-07-28 migration records the active-redemption unique index as applied
in production. Verify the intended database:

```sql
SELECT i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid)
FROM pg_index i
WHERE i.indexrelid = to_regclass('pack_redemptions_active_appointment_unique');
SELECT appointment_id, count(*) FROM pack_redemptions
WHERE removed_at IS NULL AND appointment_id IS NOT NULL
GROUP BY appointment_id HAVING count(*) > 1;
```

The index must be valid and unique on appointment_id, excluding removed rows;
the duplicate query must return no rows. The local integration test races two
active burns, checks that the database rejects one, and verifies a replacement
is allowed after undo. The restore test explicitly checks that status_reason
is cleared when a cancellation is restored without a new reason.

No production data mutation is included. CORE-5 carries the seven customer
merges and 入江真之's purchase/redemption date correction separately.
