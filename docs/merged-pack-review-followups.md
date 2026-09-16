# Merged pack review follow-ups

Original Greptile findings are retained here so their resolution is reviewable.

- Core #86, P1: **“Date Inputs Reject Timestamps.”** The public purchase timestamp and recent-redemption `since` inputs became date-only. [Original comment](https://github.com/Synqed-kk/synqed-core/pull/86#discussion_r3997870907). Restore ISO timestamps with explicit timezone offsets, retaining impossible-date rejection and existing date-only output. API regression tests cover date-only, UTC and offset inputs.
- Core #102, P2: **“Sharing index missing from Prisma.”** [Original comment](https://github.com/Synqed-kk/synqed-core/pull/102#discussion_r4020435254). Declare the same tenant/group index and name already present in the production migration. No production SQL or data change is needed.
- Core #102, P2: **“Sharing tests absent from CI.”** [Original comment](https://github.com/Synqed-kk/synqed-core/pull/102#discussion_r4020435260). Add a disposable Postgres job that installs the original append-only audit trigger and family-sharing SQL before testing final-unit concurrency, identity erasure, visitor attribution and correction compatibility.

The merged manual migrations remain unchanged. These fixes must pass local Standards/Spec review, contract CI and Greptile 5/5 before release.
