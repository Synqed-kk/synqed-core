# Karute recording/save postmortem — September 2026

Updated from authenticated production reads on **2026-09-10 04:51 UTC / 13:51 JST**. Times below are JST unless marked otherwise.

**Status:** the schema outage and staff-ownership defect are fixed. New production recordings from both affected staff members have completed jobs and saved Karutes. Three sessions still need individual recovery investigation. No production records were modified during this verification.

## What happened and why

Two defects in the September 4 Core release broke different stages of Karute:

1. **Code shipped before its database prerequisites.** [Core #81](https://github.com/Synqed-kk/synqed-core/pull/81) added a default record filter referencing `KaruteStatus.DISCARDED`, but production lacked that enum value. PostgreSQL rejected reads with `22P02`. Discard reads also referenced missing columns and failed with Prisma `P2022`. Four manual migrations had not been applied. A successful application build did not establish database compatibility.
2. **Recording authorization confused two IDs for the same staff member.** The new check compared a recording's `staffId` only to the verified actor's staff-card ID. Karute also stores the person's authentication-user ID in that field. Ordinary staff therefore appeared to be accessing someone else's recording and received 403 during reservation/finalization. Privileged users could pass the cross-owner check, masking the defect during owner testing. [Core #93](https://github.com/Synqed-kk/synqed-core/pull/93) accepts either ID of the verified person while retaining `records.write` and cross-owner restrictions.

A separate deployment problem then affected the authorization fix: a legacy Vercel catch-all rewrite routed requests to `/index.js`. [Core #94](https://github.com/Synqed-kk/synqed-core/pull/94) removed it.

These were engineering release and verification failures. Staff following the recording flow should not have had to discover them.

## Timeline and impact

| Time | Event |
| --- | --- |
| Sept 4, 16:37 | According to Liam's incident report, #81 deployed without its manual migrations; record-reading screens failed. |
| Sept 4, 20:35 | Staff encountered/reported the outage in Liam's timeline, almost four hours after deployment. |
| Sept 4, 21:45 | Liam reports applying all four SQL files to `synqed-core-tokyo`, restoring reads without redeployment. Reported outage: **5 hours 8 minutes**. Historical migration execution times have not been independently queried here. |
| Sept 9, early morning | #93 corrected ownership; #94 corrected routing. GitHub records successful production deployment of #94 at 04:25. |
| Sept 9, 12:01 | Hara's previously stranded 3,791-second audio upload was finalized. Production now shows its Karute was already saved Sept 7 at 19:56. That later audio receipt was not evidence of a missing Karute. |
| Sept 9, 14:05–16:05 | Shinohara's older, roughly 64-minute recording was finalized, then produced 21 transcription receipts across retries. Its job ended `FAILED / EMPTY_TRANSCRIPT`, with no Karute row. |
| Sept 9, 15:16 | A **new** Shinohara recording, started at 14:05, completed its worker job and saved a Karute. |
| Sept 9, 19:58 | A **new** Hara recording, started at 19:00, completed its worker job and saved a Karute. |
| Sept 10, 00:27 | [Core #98](https://github.com/Synqed-kk/synqed-core/pull/98) merged as `af5e490617a33e545eb6061c83905898c89fec34` and deployed successfully. It adds regression coverage and release safeguards; the runtime fixes were already in #93/#94. |

The staff-save symptom did not mean every staff Karute was lost. Both the screenshots and current production records contain successful saves during the period. A created session, a finalized audio upload, a transcription receipt and a saved Karute are separate milestones. Transcription receipts record provider processing/spend even when the resulting text is empty. Existing save emitters log `karute.save` after a successful Core save.

## Why our checks missed it

- Main was unprotected when inspected. A migration workflow existed, but was not a required merge condition.
- The old migration check covered only newly added SQL files and accepted a generic `migrations-applied` label. That label could survive a later SQL change.
- Tests using staff-card ownership did not exercise the authentication-user ownership shape produced by the app. Owner testing could also bypass the failing restriction.
- Build/deployment success did not verify real routes or the ordinary-staff recording-to-save outcome.
- A worker dispatch request can return HTTP 200 while its individual job fails. The observed empty-transcript failures demonstrate why request status alone is insufficient monitoring.

## Fixed and verified

- Liam reports applying the four manual migrations: `2026-09-01-karute-discarded-status.sql`, `2026-09-02-recording-discard-karute-key.sql`, `2026-09-03-recording-discard-confirmation.sql`, and `2026-09-03-transcription-segment-unique.sql`. Current authenticated Karute and discard reads return 200. This verifies the original read failure is absent, not every database constraint independently.
- The ownership regression was reproduced in an isolated checkout: restoring the pre-#93 predicate made the auth-user case fail with 403 at reservation; the staff-card case passed. Restoring #93 made both pass.
- Production `/v1/health` and scoped data reads return 200. The Core production alias resolves to [deployment `dpl_6EzNWtz85EzTaTAywsCCQZY5d7Dx`](https://vercel.com/synqed-kk/synqed-core/6EzNWtz85EzTaTAywsCCQZY5d7Dx).
- #98 covers SDK calls, Core authorization, finalization, job execution, idempotent save and subsequent reads against real PostgreSQL. It substitutes token verification and AI/storage output, so it does not simulate a real iPhone or provider.
- Validation passed: 42 Karute save/audit tests; 9 Core recording/auth/discard tests; 4 migration-gate tests; Core type checking/build; post-merge recording-contract CI. Final PR review reported 5/5 with no actionable findings.
- Both `check` and `recording-contract` are now required on main, including administrators, with up-to-date enforcement. Force pushes and branch deletion are disabled.
- Migration checks now include additions, modifications, deletions and moves. Confirmation must name the exact PR head as `db-ok:<full SHA>`; a later commit invalidates it. This remains human attestation, not automatic production migration execution.
- Separate from those tests, production has fresh sessions from both affected staff members with finalization receipts, `DONE` jobs and linked Karutes. We have not directly operated their phones or verified their installed app versions.

## Remaining recovery work

Of the **15 sessions created since September 4** in the recent production cohort, **12 have linked Karutes and completed jobs**. Three have no linked Karute or explicit discard event:

| Session prefix | Observed state | Next step |
| --- | --- | --- |
| `a892938e` | Sept 8 Shinohara session; finalized Sept 9; `FAILED / EMPTY_TRANSCRIPT`; 21 transcription receipts. | Check audible speech and audio decoding, then provider behavior. Repeatedly retrying unchanged audio has not helped. Never invent a record from an empty transcript. |
| `847fd9bc` | Sept 9 Hara session started 12:07; reserved audio path, no duration, finalization receipt or job. | Check the originating phone's retained take and whether the reserved object exists. A path alone does not prove uploaded audio. |
| `7e151e17` | Sept 7 session; no audio pointer, finalization receipt or job. | Determine whether a take was completed and whether audio remains on the originating device. An initiated session alone does not establish a lost completed recording. |

The empty transcript's cause is **not established**: silent input, audio/container decoding and an empty provider response despite valid speech remain possibilities. The reported App Store update timing is also a clue, not proof of another app defect. A playback check has been requested.

Vercel access is now confirmed as `anthony-4054` in `synqed-kk`; the earlier account mismatch is resolved. Database/storage secrets are marked sensitive and are not exportable through Vercel. The available Deepgram key cannot read historical request diagnostics (403). Verification used authorized Core reads and Vercel logs; it did not bypass those restrictions or replay paid transcription calls.

## Follow-up and closure

Engineering must recover or account for the three sessions individually, checking audio, customer binding, consent, existing records and discard state before recovery writes. Production migration application/checking still needs to become part of the release process; the required attestation remains dependent on a person checking the correct database. Deployment verification should include authenticated reads and ordinary-staff saves across supported mobile versions. Operational alerts should detect failed/stuck jobs and finalized recordings without saves, rather than relying only on HTTP errors.

Close the incident only after staff confirm fresh saves are visible on their devices and each unresolved session is recovered or explicitly accounted for. Deployment success alone is not data recovery.
