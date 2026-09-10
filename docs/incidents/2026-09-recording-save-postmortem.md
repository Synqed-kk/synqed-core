# Karute recording/save postmortem — September 2026

Updated from authenticated production reads on **2026-09-10 23:30 UTC / September 11 08:30 JST**, with full-file audio decoding and a backup comparison completed at **23:33 UTC / September 11 08:33 JST**. Times below are JST unless marked otherwise.

**Status:** the schema outage and staff-ownership defect are fixed. New production recordings from both affected staff members have completed jobs and saved Karutes. Of the original 15-session incident cohort, 14 now have saved Karutes. One recording remains failed: its uploaded audio decodes entirely to digital silence. No production recording, job, or Karute rows were modified during this verification.

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

## Recovery and playback verification

The original recent-production cohort contained **15 sessions created since September 4**. At the first check, 12 had linked Karutes and completed jobs. At the September 10 23:30 UTC recheck, the two previously unfinished sessions below also have `DONE` jobs and linked Karutes: **14 of the original 15 are now saved**. Those two saves occurred before this recheck; they were not created by the playback investigation.

| Session prefix | Verified current state | Recovery conclusion |
| --- | --- | --- |
| `a892938e` | Sept 8 Shinohara session; `FAILED / EMPTY_TRANSCRIPT`; no Karute. The full stored upload decodes to digital silence. | All 647 backup segments assemble byte-for-byte to the same silent file. No speech is recoverable from those server copies; check whether a different original take exists on the device. |
| `847fd9bc` | Previously unfinished Hara session; now `DONE`, with Karute `9e324b2c-e268-44ba-b75f-1fe0f6ef5cae` created Sept 10 at 23:04 JST. Stored take exists. | Previously open recovery case is now saved. |
| `7e151e17` | Previously pointerless session; now `DONE`, with Karute `1c776033-9143-442f-b166-ff251d4a2c27` created Sept 10 at 23:02 JST. | Previously open recovery case is now saved. |

### What the failed audio contains

The exact object named in the failed job was downloaded read-only from production storage. It is a **14,065,377-byte WebM/Opus file**, marked as encoded by WebKit, with mono 48 kHz audio. FFmpeg successfully decoded the complete file: **185,805,240 samples, approximately 64 minutes 30.94 seconds**. Its floating-point audio statistics report minimum and maximum sample levels of **zero**, peak and RMS levels of **negative infinity**, and no NaNs, infinities, or decode errors. This is digital silence throughout, not merely quiet speech or an unsupported container.

All **647** stored backup segments, consecutively numbered `000000.webm` through `000646.webm`, were also downloaded read-only and concatenated in order. Their combined size is **14,065,377 bytes**, and the assembled bytes exactly equal the original upload. Both have SHA-256 `ffbbd9d7dcd50d325815077e7158f1ff04b359ca27e6f30b4ed142af049453bd`. No separate rescue object exists for this take. The available server-side backups therefore contain the same silence.

This establishes why that stored input could not produce a transcript. It does **not** establish why the originating device produced silent audio. The App Store update timing, microphone interruption/muting, and device capture behavior remain investigation leads; none has been reproduced as the specific trigger. The worker's empty-transcript refusal protected against inventing a Karute. Re-running paid transcription on the unchanged file is not a recovery strategy.

### Access and evidence limits

The live Karute login bundle and the signed-in Supabase dashboard both identify the production project as `synqed-core-tokyo` / `xtcqtkaaicxzlkrvnesf`. An older repository reference, `jdbsqvlfwsmzfmisuwmw`, was mistakenly used during access troubleshooting and caused misleading permission failures. The reference was corrected before any account mutation or recording inspection. This investigation error delayed verification; it was not a cause of the September 4 application outage.

The playback investigation used a 24-hour project-scoped token, the Supabase CLI, authenticated Core reads, and read-only storage downloads. Production recording and Karute state was preserved, and no additional transcription provider call was made. Historical Deepgram request diagnostics remain unavailable to the existing provider key, but the full local decode now establishes what the stored input contains.

## Follow-up and closure

The two subsequently saved sessions are accounted for. Engineering must check whether the originating device retains a different take, then either recover that valid audio through the normal consent/discard checks or explicitly account for the unrecoverable speech. Investigate how a recording with no audio signal can continue unnoticed, including interruption/mute handling and user-visible feedback, without assuming the device trigger from timing alone. Production migration application/checking still needs to become part of the release process; the required attestation remains dependent on a person checking the correct database. Deployment verification should include authenticated reads and ordinary-staff saves across supported mobile versions. Operational alerts should detect failed/stuck jobs and finalized recordings without saves, rather than relying only on HTTP errors.

Close the incident only after staff confirm fresh saves are visible on their devices and the remaining silent session is recovered or explicitly accounted for. Deployment success alone is not data recovery.
