# September recording/save incidents

> Historical investigation notes. See the [updated postmortem](2026-09-recording-save-postmortem.md) for the merged/deployed fixes, confirmed Synqed access, production save verification and remaining recovery work.

## Confirmed causes

1. Core PR #81 deployed code that needed four manual database migrations before those migrations were applied. The new default Karute reads referenced the missing `KaruteStatus.DISCARDED` value; discard reads also referenced missing columns. Liam reported applying the four migrations on September 4 and immediate recovery. This report has not been independently checked against production in this investigation.
2. The same release compared `recording_sessions.staff_id` only with the verified actor's staff-card ID. Karute also writes this field using the auth-user ID. Ordinary staff could therefore create a recording but receive 403 when reserving/finalizing it. Core PR #93 fixes ownership to recognize either ID of the verified person while retaining `records.write` and cross-owner restrictions.
3. The deployment of #93 exposed a legacy Vercel catch-all rewrite that routed requests to `/index.js`. Core PR #94 removed that rewrite. GitHub reports a successful production deployment of #94 at 2026-09-08 19:25 UTC; a deployment status is not an authenticated recording smoke test.

## Reproduction and prevention

`tests/recording-save-lifecycle.test.ts` exercises the actual SDK, Core router, authorization, job storage and PostgreSQL writes. It runs ordinary staff through recording creation, pointer reservation, finalization, job enqueue/claim, a synthetic AI result save, retry, completion, detail read and store/customer list read. Both auth-user and staff-card record shapes are covered.

Replaying the pre-#93 ownership predicate makes the auth-user case fail with 403 at reservation; the staff-card case still passes. Restoring #93 makes both pass. This explains why tests using only staff-card IDs missed the incident.

The `Recording save contract` workflow runs these tests alongside authorization and discarded-status regressions against a fresh PostgreSQL database. It substitutes token verification and AI/storage outputs, so it does not prove a real iPhone, provider calls or the production worker completed a recording.

The migration workflow now checks all manual SQL changes, including modifications, deletions and renames, and requires an exact `db-ok:<full PR head SHA>` label. Any new commit invalidates older confirmations, including the legacy `migrations-applied` label. The label remains a human attestation; after every push, recheck the production SQL and add the new revision’s label. It does not query production. Production migration application is still a separate operation; `prisma db push` in the recording workflow is only for the disposable test database.

Repository settings must require both `check` (Migration gate) and `recording-contract` before merges. Core main was unprotected when initially inspected. On September 9 the existing GitHub Actions `check` was made required with strict up-to-date enforcement, including for admins; force pushes and branch deletion are disabled. Add `recording-contract` to required checks once this new workflow lands. Workflow files alone cannot enforce merge blocking. No production migration or deployment is performed by this patch.

## Outstanding production verification

The supplied audit screenshots distinguish audio receipts (`recording.capture_finalized`) from Karute saves (`karute.save`). A September 9 12:01 JST audio receipt for a recovered 3,791-second recording proves an accepted audio finalization, not a completed Karute. Earlier screenshots include genuine staff Karute-save events. Liam reports those existing records are visible in the list; the missing cohort consists of recordings without Karute rows. His later report that saving stopped after an app update is an additional client-version clue, not a proven second cause.

For each affected session, inspect the recording row, finalized audio pointer, job status/attempts/last error, Karute-by-recording lookup and correlated audit events. Verify one fresh ordinary-staff recording through the deployed iPhone flow, including the worker and final list visibility. Distinguish a recovered audio upload that still needs customer selection/processing from a fresh stopped take that should automatically save.

Use the Synqed Vercel team (`synqed-kk`) and Supabase project `synqed-core-tokyo`. The initial Vercel login exposed only `spases-ai`. Re-login as `alee9011` succeeded but exposes only `alee9011s-projects`, without `synqed-kk` membership. No authenticated production verification or recovery was performed. Do not bulk requeue recordings without checking customer binding, consent, explicit discards and whether a record already exists.
