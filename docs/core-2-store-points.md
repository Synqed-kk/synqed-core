# CORE-2 member accounts and issuing-store points

Anthony's September 8 decision: points belong to the issuing store. Pooling is deferred. Existing salon-customer claiming is also deferred, but does not block the other member features.

This slice creates a verified platform member account and a real per-store earn/spend ledger. It does not finish all of CORE-2. Stripe fulfillment, lifetime-spend ranks, member booking metadata and confirmation delivery remain separate work. CORE-13's check-in, content and referral events can call `recordPointsIn` within the source event transaction; they are not wired by this slice.

## Authentication and scope

The Reserve BFF retains the Core API key and forwards the member's Supabase bearer token. Core verifies it with Auth on each request. A member can create/read only their own platform account. No member request accepts an account ID as authority. Registering an account grants no access to existing salon customers; `POST /v1/members/me/claim` returns 501 until the design conversation happens. There is no phone/email/name-based claim.

Member registration/read/claim require the API key and bearer but no business header. Store ledger and daily-open routes also require the business header, and Core verifies the store belongs to it. New tables have RLS enabled with no browser-role policy; Core uses its existing trusted database role.

## Routes

- `POST /v1/members/me`: `{ displayName }`; repeated registration returns the same account without replacing its profile.
- `GET /v1/members/me`: `{ accountId, displayName }`.
- `GET /v1/members/me/stores/:storeId/points?cursor=&limit=`: store-specific complete balance, one page of entries, and next cursor. Default page 50, max 100. The cursor is the last entry UUID; account/store scope is checked before using it.
- `POST /v1/members/me/stores/:storeId/daily-open`: server-derived JST day, configured reward, at most one award per account/store/day. Zero/unconfigured means no award.
- `PUT /v1/member-points/stores/:storeId/policy`: `{ dailyOpenPoints }` (0–1000); verified staff with `settings.manage` and store visibility, with audit.
- `POST /v1/member-points/stores/:storeId/adjustments`: `{ accountId, amount, reason }` plus UUID `Idempotency-Key`; verified staff with `billing.manage` and store visibility. The immutable ledger records actor, reason and reference. Negative corrections cannot overdraw the store balance.

The authoritative points response adds required `businessId` and `storeId` scopes to the earlier provisional Reserve contract. Never present the old platform balance or sum store balances as a spendable total. The BFF must adapt these Core routes and shapes when member live data is enabled.

## Integrity

A wallet is a scope and lock row, not a stored balance. Signed immutable entries derive the complete balance. Database uniqueness makes source-event retries idempotent; altered retries conflict. Concurrent first awards use INSERT ON CONFLICT and wallet locking. Spend checks and insertion share the same lock and transaction, preventing overdrafts. A failed source event rolls back its points. Corrections append entries, never update old rows. There is no member-provided earn amount or public generic spend endpoint.

Staff policy defaults do not invent an earn amount. Daily-open rewards remain off until configured. Visit/content/referral award amounts must come from their verified source-event implementations; the member cannot award those events by calling this ledger.

## Rollout and validation

Apply `prisma/migrations/manual/2026-09-08-member-store-points.sql` before deploying this slice. **Not applied to production.** Do not label the PR migrations-applied until it is actually executed there.

Run `npm run typecheck` and `DATABASE_URL=<local-test-db> npm test -- tests/member-points.test.ts`. Tests verify authenticated self-only access, claim stub, repeated accounts, concurrent retries/spends, transaction rollback, account/business/store isolation, pagination with complete balance, configured daily awards, and PostgreSQL append-only enforcement. Test events use fresh random scopes and remain in the test ledger rather than disabling its integrity trigger.
