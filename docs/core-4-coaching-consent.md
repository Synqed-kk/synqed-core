# CORE-4: private coaching consent

[CORE-4](https://linear.app/synqed-jp/issue/CORE-4) and Karute's
`docs/coaching/COACHING_VISIBILITY_MODEL.md` and `COACHING_V2_DESIGN.md` are the contract.
The enforcement choice is **Core verifies the human actor on every request**.
The BFF sends its API key, business header, and the human's Supabase bearer token.
An API key alone cannot read or change consent. Direct browser database access is
blocked by RLS with no policies; there is no owner exception.

## API / SDK

- `GET /v1/coaching-consent/me`: current policy version, effective status
  (`unset`, `granted`, `declined`), and the caller's latest decision.
- `POST /v1/coaching-consent/me`: `{status, policy_version}`. Only `granted` or
  `declined` is accepted. Staff/card/actor IDs cannot be supplied. Every accepted
  decision appends a row; nothing edits history or emits a manager-visible audit.
- `GET /v1/coaching-consent/me/history`: own decisions, newest first, 50 per page.
  Optional cursor is a returned decision UUID belonging to the caller. Sequence
  numbers stay internal so a cursor does not disclose other tenants' activity.
- `GET /v1/coaching-consent/stores/:storeId/adoption`: `{granted,total}` only.
  Requires current `analytics.viewAll` and store visibility. Counts active staff
  assigned to that store, including staff with no store assignments (the existing
  all-stores semantic). No names, IDs, timestamps, or decline histories are returned.

The SDK exposes these as `client.coachingConsent.me/decide/history/adoption`.
Construct it with the current human's `accessToken`. Responses are private/no-store.

Policy version comes from `org_settings.settings.coaching_policy_version`; legacy
positive integers normalize to strings. An absent or invalid value (including an oversized string) uses the current Karute
policy `v1.0-2026-05`. A version change invalidates earlier grants and returns
`unset`; stale grant submissions return 409. Withdrawal is always allowed from a
stale dialog and is stamped with the current policy. UI code must fetch the current
version before offering consent and must not import a localStorage grant.

The log is append-only, with an internal monotonic sequence for deterministic order
even when timestamps tie. An insertion trigger validates the active staff card's
business and a CHECK requires self-authorship. As with `staff_policy_events`, history
retains only card and authenticated-subject identifiers after ordinary staff deletion; no FK blocks existing
offboarding, and a deleted/inactive login cannot read the history. Consent is bound to both the card and the verified login: reassigning a card
to a new account cannot transfer prior consent or expose its history. This is consent
evidence, not the generated L1 artifact store.

## Deployment and remaining work

Apply `prisma/migrations/manual/2026-09-08-coaching-consent.sql` manually before API
and SDK deployment. It has been applied only to the disposable local test database.
Do not mark the production migration gate applied based on local test results.

This PR supplies persisted consent and its authenticated API/SDK. Karute's local
consent hook still needs BFF wiring. It does **not** activate generation or finish
CORE-4: generation must check consent before calling the provider and recheck the
same decision under the staff-row lock before persisting, so revoke/regrant during
an in-flight call cannot resurrect old content. The adapter, partitioned
`ai_interactions`, remaining L1 tables, staff deletion, grants/access logs, L2 bands,
module persistence, and L3 config remain tracked work. Consent itself is never
manager-shareable. Existing `recordings.viewAll` remains unchanged: listening to raw
recordings can reconstruct detail the coaching boundary hides.

Verification: nine database/HTTP regressions cover active verified identities,
self-only history including owner denial, store-scoped aggregate-only adoption,
policy changes/withdrawal, pagination ties, immutable DB history, scope/authorship,
offboarding, and the absence of direct browser RLS policies.
