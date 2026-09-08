# CORE-4 read filters

The existing business-scoped ledger endpoints now accept the filters needed by coaching callers. These are trusted server-to-server reads; they do not implement or replace the separate consent and L1 grant boundary.

- `recordingDiscards.list`: use the existing `recording_session_id` or a set `recording_session_ids` (1–100 UUIDs, comma-separated on HTTP), never both. `created_from` is inclusive and `created_before` is exclusive; both are ISO datetimes with a timezone. They filter the discard event's creation time. Source, session, and date conditions intersect before pagination and counting. Empty/malformed sets and reversed date ranges return 400 rather than an unfiltered stream.
- `karuteOutcomes.list`: `staff_id` names the permanent staff card that owns the karute record, not the staff member who decided its outcome. `karute_record_id` restricts to one record. These intersect with existing outcome, decision-context, and age conditions. Both parent record and outcome must belong to the caller's business when filtering by staff.
- Both lists use an ID tie-breaker to make pagination deterministic for equal timestamps. Counts describe the same filtered set as the page.

The SDK exposes all new options. No migration is required for these read filters. CORE-4 remains in progress: consent, personal-artifact authorization, grant lifecycle, staff ID normalization/backfill, and coaching storage are separate remaining work.
