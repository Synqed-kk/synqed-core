# CORE-5 exact customer repairs

Source: Liam's CORE-5 comment `6231e875-4412-4384-984f-b9261320140a`, September 8, 2026. The comment corrects the original ticket: neither 小澤真里奈 record has a pack, and both 山形佳美 and 金高恩 have two packs that must survive.

## Apply status

**Not applied to production.** Target is synqed-core-tokyo, business `7bb76aac-2947-47fb-b883-d85fe849ccec`. Keep weekly ticket-sync holds until application and verification succeed. The migration gate must remain unsatisfied until then.

The one manual SQL migration carries all seven exact KEEP/FOLD UUID pairs and nine expected packs. It moves existing rows, soft-deletes each twin, and records seven merge audits. It corrects the existing 入江真之 redemption and pack purchase dates to December 25, 2025 and sets that consumed pack to `exhausted`, with a separate audit. No burn is inserted and no pack balance is rewritten.

## Operation

Run with an existing protected production connection, during the sync hold / maintenance window:

```sh
psql -X "$DATABASE_URL" --set ON_ERROR_STOP=1 --file prisma/migrations/manual/2026-09-08-core-5-customer-merges.sql
```

The transaction locks affected tables before checking chart numbers, business ownership, exact pack sizes and active redemption counts. It aborts on drift, guardian relationships, conflicting external identities, or an unmapped customer dependency. Inspect any failure against the current live records; do not bypass the precondition. Locks time out after five seconds rather than waiting indefinitely. Any error rolls back every repair.

Known child history is retargeted without changing its other fields. Existing audit entries remain append-only; new merge audits link the two identities and record moved row counts. If both customers have a lifecycle singleton, the live customer's current state wins and the import singleton stays attached to the soft-deleted twin as provenance. Customer profile fields and imported aggregate totals also remain on their original records; the repair does not invent a sum across overlapping histories. Nonconflicting external lookup references are copied onto KEEP. A rerun requires the completed merge marker and matching audit, rejects new rows on a folded twin, and adds no audits or changes.

## Verify before releasing holds

Confirm seven `merge_duplicate` audits and one `correct_pack_import_date` audit carrying migration `2026-09-08-core-5-customer-merges`. Confirm all seven twins are soft-deleted, the KEEP records are active, and moved history belongs to KEEP. Confirm unchanged pack balances: 伊藤照子 2/6; 木下文 7/10; 山形佳美 1/6 plus 5/6; 中山世奈 5/10; 中川由佳理 13/20; 金高恩 2/10 plus 1/6. 小澤真里奈 still has no pack. Confirm 入江真之 still has exactly six active burns, both corrected dates are 2025-12-25, and the pack is exhausted.

Only after successful live verification, add the `migrations-applied` PR label and report that holds can be released. Committing, merging, and passing local tests do not execute the production repair.

## Local regression

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55439/postgres npm test -- tests/core-5-customer-merges.test.ts
```

Requires local PostgreSQL, `psql`, `pg_dump`, and CREATE DATABASE permission. Tests copy only the test database's schema, including manual constraints, into a uniquely named disposable database. They seed synthetic rows using the exact IDs, execute the actual SQL, and drop the disposable database. They never run the repair against the source database. Coverage includes preservation of money, undo state and bookings; both double-pack pairs; exact date correction; idempotency; changed balances; conflicting identities; and unknown foreign-key dependencies.
