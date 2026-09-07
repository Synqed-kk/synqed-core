# Store settings (CORE-10)

`storePolicies.get/list/set` persist all 17 new policy fields; `stores.create/update`
also accept nullable `photo_url`. Policy `set` retains the existing HQ gate and
required session-derived `acting_staff_id` trusted-BFF contract. Each effective
change writes automatic audit rows in the same transaction, containing changed
fields with before/after values and the acting staff. Caller-supplied audit metadata
is optional; it cannot override the authoritative actor, store, action or changes.
Large collection changes use indexed entries with before/after lengths; bounded
chunks share `request_id` and carry `part`/`parts` so the complete change can be
reconstructed without the audit service truncating it. No-op saves do not add a change event. Store locking serializes partial first saves
and ensures concurrent audit comparisons use the committed previous state.

| Setting | Default / accepted values |
| --- | --- |
| override_roles | オーナー, 店舗管理者, スタッフ |
| override_locked_out | empty staff-ID array |
| override_hold_to_confirm | true |
| override_strict_wall | false |
| min_sellable_min | 30; integer 0–1440 (0 disables) |
| gap_fill_min_min | null; integer 0–1440 |
| held_rank_access | closed; closed/silver/gold/platinum |
| release_held_roles | オーナー, 店舗管理者 |
| booking_step_min | 30; integer 1–1440 |
| block_step_min | 15; integer 1–1440 |
| gap_fill_discount_pct | null; integer 0–30 |
| lead_time_min | null; integer 0–10080 |
| reserve_start_grid_min | null; 15/30/60 |
| standard_session_min | null; integer 1–1440 |
| price_lock_during_recalc | null; boolean |
| breaks_paid | false |
| special_open_days | empty collection of `{date, open, close}` |

Defaults are supplied only where the ticket names them; unspecified scalar
settings stay null until configured. Omitted update fields are preserved; nullable
settings can be cleared with null and collections with `[]`. Existing
`new_client_session_minutes` now allows 30–240 in steps of 15, default 90. Its old
60/75/90 database CHECK is widened in the migration as well. SDK inputs use the
exported `NewClientSessionMinutes` union. Database checks also protect the new
numeric/rank domains and validate special-day JSON, including calendar dates,
unique dates and non-inverted windows. Invalid, fractional,
nonpositive step sizes and non-finite inputs are rejected by the wire schema.

Special open dates must be unique real `YYYY-MM-DD` dates (max 366 entries), with
`HH:MM` opening before closing. `24:00` is accepted only as closing time, including
for existing weekly hours. These are persisted settings for the Business/Reserve
consumer to use; this change does not add a booking enforcement engine. The two
withdrawn room-policy switches are absent; the room-order rule stays unconditional.

Apply `prisma/migrations/manual/2026-09-07-store-policy-settings.sql` before API
release. SDK publication and Business reconnection follow deployment.

## One-time hours backfill at Business reconnection

The stored source is `org_settings.settings.operating_hours`, in Karute's
`{mon: {openMinute, closeMinute}, ...}` format. This is business-wide and copied
to each store whose `weekly_hours` is unconfigured. Existing configured hours are
preserved. Missing/invalid source hours are reported and skipped, never defaulted.
The converter preserves midnight closing as `24:00`.

With `DATABASE_URL` pointing at the intended database, preview:

```sh
npx tsx scripts/backfill-store-hours.ts
# Optional single-business scope:
npx tsx scripts/backfill-store-hours.ts --business BUSINESS_UUID
```

Review `would_update` rows and their proposed hours; resolve
`missing_or_invalid_hours` rows using the original organization settings. At the
approved reconnection time, add `--apply`. The script rechecks each target under
the policy writer's store lock, updates only unconfigured stores, and commits a
system audit event atomically. Re-running skips configured targets. The script has
been tested only against a temporary database; production backfill is pending.
