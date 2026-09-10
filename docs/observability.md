# Observability

Built after the 2026-09-04 outage. See `docs/incidents/2026-09-recording-save.md`
for what happened. The short version: core deployed at 16:37 needing four
manual migrations that were never applied, every record read threw, and a
person reported it at 20:35. Nothing watched production in between.

## What answers "is production healthy?"

| Endpoint | Checks | Use it for |
| --- | --- | --- |
| `GET /v1/health` | Nothing. Returns 200 if the process serves. | Platform liveness. |
| `GET /v1/health/ready` | Database reachable **and** schema matches this build. 503 otherwise. | **Uptime monitors and paging.** |

`/health` used to be the only one, and it returned a hardcoded `{status:'ok'}`.
It answered 200 for the entire five-hour outage. A health check that cannot
fail is not a health check — point monitors at `/health/ready`.

Readiness is reachable without an API key so any monitor can page on the 503.
The `gaps` array names tables, columns and migration files, so it is returned
only to a caller sending a valid `x-api-key`. Alerting does not require
disclosure.

### Reading a degraded response

```json
{
  "status": "degraded",
  "database": "ok",
  "schema": "drift",
  "gaps": [
    {
      "kind": "column",
      "subject": "recording_discard_events.confirmed_by",
      "migration": "2026-09-03-recording-discard-confirmation"
    }
  ]
}
```

`schema: "drift"` means production is missing something this build requires.
Apply the files named in `gaps[].migration` from `prisma/migrations/manual/`,
in filename order, then re-probe. No redeploy is needed — that matches how the
2026-09-04 recovery actually worked.

`database: "unreachable"` is a different problem: core cannot reach Postgres at
all. Migrations will not help.

## The schema contract

`src/db/schema-contract.ts` asks the live database whether it really has the
schema this build was compiled against.

The migration gate (`.github/workflows/migration-gate.yml`) blocks a merge on a
human attestation. As the incident write-up says, that label *"does not query
production"*. This contract is the half that does.

**Tables, columns and enum values are derived from the Prisma schema**, via
`Prisma.dmmf`. Nothing to maintain: every model Prisma knows about is checked
automatically. A hand-curated list is only as good as the last person who
remembered to update it, and a contract that silently under-covers is worse
than none, because it reports healthy while the routes it forgot fail at
runtime.

**CHECK and UNIQUE constraints are the exception.** The DMMF does not model
them, so `CONSTRAINT_CONTRACT` lists them by hand. Add an entry when a manual
migration adds one the code relies on.

A missing table or enum type is reported once rather than once per column, so
the one line an operator needs is not buried.

Every catalog query is scoped to `current_schema()`. Supabase databases carry
`auth`, `storage` and `extensions` schemas alongside the application's, and an
identically named enum or constraint in one of those would otherwise satisfy
the contract while the object actually needed is missing.

`tests/observability-health.test.ts` asserts the whole derived contract
resolves against a migrated database, so drift or a broken derivation fails CI
rather than production.

## Logs

Every line is one JSON object on stdout. Field names match Karute's audit
emitter (`at`, `severity`, `request_id`, `business_id`) so both halves of the
stack land in one drain under one schema.

| `evt` | When | Notable fields |
| --- | --- | --- |
| `http` | Every request, including failures | `method`, `path`, `status`, `duration_ms` |
| `error` | Unhandled error | `kind`, `prisma_code`, `pg_code`, `message`, `stack` |
| `health.ready` | Readiness found a problem | `schema`, `gaps`, `pending_migrations` |
| `boot` | Process start | `port` |

`kind` on an error line is the field worth alerting on:

- `schema_drift` — the deployed code expects a shape production does not have.
  Never a caller's fault, never self-recovering, takes every read down. Core
  answers **503** for these, not 500, because a retry cannot fix it.
- `db_unreachable` — cannot reach Postgres.
- `validation` — a caller sent something bad. Noise, not an incident.
- `unknown` — everything else.

A malformed UUID and a missing enum value both surface as Postgres `22P02`.
Only the enum wording is drift; the UUID is ordinary validation. That
distinction is tested in `tests/observability-errors.test.ts` — if it
regresses, the drift alert fills with caller errors and gets muted.

## Request correlation

Karute's facade mints a canonical request id per request. It now travels to
core as `x-request-id`, and core echoes it on the response and stamps it on
every log line. One id spans the stack.

Core generates its own id when a caller sends none, and replaces an inbound id
that is empty, over-long, or outside `[\w.:@/+-]` — a caller-supplied header
lands in a log line, so it is untrusted input.

The middleware runs **before** auth, so a 401 storm is correlated too.

## Sentry

Optional. With no `SENTRY_DSN` every Sentry call is a no-op, so tests, local
dev and a DSN-less deploy behave exactly as before.

Tags set on each event: `request_id`, `business_id`, `route`, `error_kind`,
`prisma_code`, `pg_code`. `release` is `VERCEL_GIT_COMMIT_SHA`, which ties an
error to the deploy that introduced it — the correlation the incident write-up
had to do by hand.

`schema_drift` is captured at **fatal**.

### Alert rules to create

1. **Schema drift — page immediately.**
   Condition: an event with `error_kind:schema_drift`.
   Threshold: 1 occurrence. Do not batch or digest this one.
2. **5xx spike.** More than 25 events in 5 minutes, grouped by `route`.
3. **New issue in a release.** Catches a regression introduced by a specific
   deploy.

## Monitoring

`.github/workflows/readiness-monitor.yml` polls `/v1/health/ready` every 15
minutes, on manual dispatch, and on every push to `main`. A failed scheduled
run notifies repo owners.

Required repository secrets:

| Secret | Purpose |
| --- | --- |
| `CORE_URL` | Base URL, no trailing slash, e.g. `https://core.synqed.jp` |
| `CORE_API_KEY` | Optional. Without it the run still detects the 503 but cannot print which migrations are missing. |

On a **push**, the monitor will not accept a green answer from the build being
replaced. Readiness echoes the `release` it is serving
(`VERCEL_GIT_COMMIT_SHA`), and the push run waits until that matches the pushed
commit before trusting a 200. Without that check a push could probe the
previous deploy, report `Readiness OK`, and let a drifted new build through
until the next scheduled run.

GitHub's scheduler is best-effort and can lag under load. It is a safety net,
not a substitute for a real uptime monitor pointed at the same endpoint.

Readiness memoizes its verdict for 5 seconds. The endpoint is unauthenticated,
and each miss costs a reachability query plus three catalog queries, so without
a bound public traffic could contend with real requests for connections. A
monitor polling every 15 minutes always gets a fresh verdict; an operator
re-probing during a migration waits at most 5 seconds to see their fix.

## Deploying a change that needs a manual migration

1. Apply the SQL to production **before** merging (`docs/incidents/…` explains
   why; the migration gate enforces the label).
2. If the migration adds a CHECK or UNIQUE constraint, add it to
   `CONSTRAINT_CONTRACT`. Tables, columns and enum values need no action — they
   are derived from the Prisma schema.
3. Merge and deploy.
4. Confirm `/v1/health/ready` returns 200. The push-triggered monitor run does
   this automatically, and waits for your commit to be the serving release.
