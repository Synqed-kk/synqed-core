# Pack corrections (CORE-12)

SDK status/redemption inputs use the exported `PackStatus` and `RedemptionSource`
unions. Callers holding arbitrary strings must validate/narrow them before calling.

New redemption sources are `recovery` and `correction`. Existing `manual`, `auto`,
`import`, `qr`, `pos`, and `backfill` remain accepted. Recovery and correction adds
require a nonblank `reason` (up to 2000 characters) and `created_by` identifying an
active core staff card in the same business. The trusted BFF must derive this
actor from its authenticated session, never from an end-user field; this follows
the existing pack API's API-key/business authentication and attribution contract.

For correction removals, call `removeRedemption(id, {source: 'correction', reason,
removed_by})`. These fields travel as encoded query parameters so a proxy dropping
DELETE bodies cannot remove the correction trail. `removed_by` must identify
active same-business staff. Removing a recovery/correction row also requires a
reason and actor even when the caller omits source or requests a legacy source.
The original source/reason/creator are retained alongside the removal's source,
reason, actor and timestamp. Legacy manual/auto undo remains compatible.

`listRecentRedemptions(since)` returns the **complete** active set from the inclusive
calendar date. There is no LIMIT, 1000-row cap, or pagination; introducing a default
cap would silently undercount existing money and reconciliation callers. The
existing envelope and array SDK return shape are unchanged. Rows now include
`source`, `reason`, `created_by`, `counts_as_visit`, and removal metadata.
`listRecentRedemptions(since, {include_removed: true})` opts into removed rows for
history. Reconciliation can exclude correction/recovery sources from real usage;
corrections still participate in the pack balance. Prices remain current pack
prices, including exhausted, cancelled and void packs, rather than sale snapshots.
The since filter applies to the redemption date, including for removed history.

`updatePackStatus(id, status)` remains the status verb. **New status: `void`**.
`active`, `exhausted`, and `cancelled` stay legal. Void is a status update, never a
hard delete: packs and redemption history stay queryable. Active-pack reads omit
void packs. Shipped phone parsers must accept the new status/source values before
a caller starts writing them; deployment alone does not convert existing rows.

`createPack(input, {idempotencyKey})` uses the `Idempotency-Key` header. Keys are
scoped to business and `pack-create`, separately from redemption scope `pack`.
Key, purchase and replay target commit in one transaction. First creation returns
201; retries/concurrent duplicates return 200 with the full existing pack. An
uncommitted failure rolls back the key too. A key identifies one intended purchase:
changing the request body does not create another purchase with that key. Replay
returns the current stored pack (including later status changes). No key preserves
the existing create-each-time behavior.

`customers.list({ids})` ignores malformed UUIDs. An all-invalid nonempty batch
returns no customers, never the full list. Absent or empty query retains normal
listing; valid batch lookups preserve business/deletion scope and batch semantics.

Apply `prisma/migrations/manual/2026-09-07-pack-corrections.sql` before API deployment.
The migration only adds nullable metadata columns and does not rewrite history.
Publish the SDK and coordinate phone enum support before enabling correction/void
writes. No production migration or client release is performed by this PR.
