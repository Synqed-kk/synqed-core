# Store settings (CORE-10)

`storePolicies.get/list/set` persist all 20 new policy fields; `stores.create/update`
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
| override_roles | owner, manager, practitioner; only rulebook role keys |
| override_locked_out | empty staff-ID array |
| override_hold_to_confirm | true |
| override_strict_wall | false |
| min_sellable_min | 30; nonnegative integer (0 disables) |
| gap_fill_min_min | null; nonnegative integer |
| held_rank_access | closed; closed/silver/gold/platinum |
| release_held_roles | owner, manager; only rulebook role keys |
| booking_step_min | 30; positive integer |
| block_step_min | 15; positive integer |
| gap_fill_discount_pct | null; integer 0–30 |
| lead_time_min | null; nonnegative integer |
| reserve_start_grid_min | null; positive integer |
| standard_session_min | null; positive integer |
| sell_slot_min | 60; positive integer, advertised sellable-slot length |
| auto_release_before | linked; linked/never/positive digit string |
| calendar_tight_max | 2; integer 0–5 (0 disables amber calendar tier) |
| price_lock_during_recalc | null; boolean |
| breaks_paid | false |
| special_open_days | empty collection of `{date, open, close}` |

Defaults are supplied only where the ticket names them; unspecified scalar
settings stay null until configured. Omitted update fields are preserved; nullable
settings can be cleared with null and collections with `[]`. Existing
`new_client_session_minutes` accepts any positive integer, default 90. The follow-up
migration removes the earlier ranges, steps and allowed-value lists. Duration inputs
have no business-policy ceiling; the existing PostgreSQL integer storage type still
applies. The app compares durations with the store's opening hours. SDK inputs are
plain numbers; `NewClientSessionMinutes` remains a number alias for compatibility.
Database checks also protect the new
numeric/rank domains and validate special-day JSON, including calendar dates,
unique dates and non-inverted windows. Invalid, fractional,
nonpositive step sizes and non-finite inputs are rejected by the wire schema.

`auto_release_before:'linked'` means the consumer follows the current `lead_time_min`
at read time, without persisting a derived value; `'never'` holds until start; a
positive digit string is minutes before start. The API returns the configured mode.
SDK role arrays use `PermissionRoleKey[]`; both wire validation and a database CHECK
enforce the nine Core rulebook keys. The migration converts only the three known
legacy default labels (オーナー→owner, 店舗管理者→manager, スタッフ→practitioner);
other unknown labels stop the transaction for explicit resolution.

Special open dates must be unique real `YYYY-MM-DD` dates (max 366 entries), with
`HH:MM` opening before closing. `24:00` is accepted only as closing time, including
for existing weekly hours. These are persisted settings for the Business/Reserve
consumer to use; this change does not add a booking enforcement engine. The two
withdrawn room-policy switches are absent; the room-order rule stays unconditional.

Apply `prisma/migrations/manual/2026-09-07-store-policy-settings.sql`, then
`prisma/migrations/manual/2026-09-15-store-policy-flexible-durations.sql`, before API
release. Keep the previously applied file unchanged. SDK publication and Business
reconnection follow deployment.

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
