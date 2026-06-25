import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// The 7 karute_outcomes rows from the karute app DB (rvkhxludlxxidjjgcnva).
// business_id is NOT stored here — it's derived from the core karute_records row
// (karute_record_id → business_id) at migrate time.
const rows = [
  { karute_record_id: '52276521-5e7e-4121-9a17-06d17402e57b', customer_id: 'bdc32bcc-d319-4ffe-94a0-85c94082294a', outcome: 'pending', reason: null, is_first_visit: true,  decided_by: null,                                   decided_at: null,                          auto_decided: false, created_at: '2026-06-09T03:57:12.909900+00:00', updated_at: '2026-06-09T03:57:12.878000+00:00' },
  { karute_record_id: '3dd66e0c-b148-4635-9cdd-d96f05075f52', customer_id: 'f7a9d968-5f79-49fa-9af7-d021af245107', outcome: 'success', reason: null, is_first_visit: false, decided_by: '5f717616-2236-4f69-82ee-aabe693db4a4', decided_at: '2026-06-09T08:06:00.181000+00:00', auto_decided: false, created_at: '2026-06-09T08:06:00.215934+00:00', updated_at: '2026-06-09T08:06:00.181000+00:00' },
  { karute_record_id: '18c7ed39-15c1-462e-a836-64f9d9eb2e34', customer_id: 'f7a9d968-5f79-49fa-9af7-d021af245107', outcome: 'pending', reason: null, is_first_visit: false, decided_by: null,                                   decided_at: null,                          auto_decided: false, created_at: '2026-06-10T13:27:34.893158+00:00', updated_at: '2026-06-10T13:27:34.831000+00:00' },
  { karute_record_id: '3bcc3536-4725-4703-b46d-0db0432ad4ac', customer_id: 'f7a9d968-5f79-49fa-9af7-d021af245107', outcome: 'success', reason: null, is_first_visit: false, decided_by: '5f717616-2236-4f69-82ee-aabe693db4a4', decided_at: '2026-06-11T03:54:50.539000+00:00', auto_decided: false, created_at: '2026-06-11T03:54:50.568063+00:00', updated_at: '2026-06-11T03:54:50.539000+00:00' },
  { karute_record_id: 'd78fef47-a690-47dc-8a55-f32ca3d75e89', customer_id: 'f7a9d968-5f79-49fa-9af7-d021af245107', outcome: 'pending', reason: null, is_first_visit: false, decided_by: null,                                   decided_at: null,                          auto_decided: false, created_at: '2026-06-20T06:48:59.163590+00:00', updated_at: '2026-06-20T06:48:59.136000+00:00' },
  { karute_record_id: '8c6e2ece-6c5e-404f-8200-ac41444e24d3', customer_id: 'f7a9d968-5f79-49fa-9af7-d021af245107', outcome: 'success', reason: null, is_first_visit: false, decided_by: '5f717616-2236-4f69-82ee-aabe693db4a4', decided_at: '2026-06-20T16:34:31.030000+00:00', auto_decided: false, created_at: '2026-06-20T16:34:31.134943+00:00', updated_at: '2026-06-20T16:34:31.030000+00:00' },
  { karute_record_id: 'e12981dd-197d-413b-aae5-f1b4d1870fbb', customer_id: 'f7a9d968-5f79-49fa-9af7-d021af245107', outcome: 'success', reason: null, is_first_visit: false, decided_by: '5f717616-2236-4f69-82ee-aabe693db4a4', decided_at: '2026-06-23T07:59:57.801000+00:00', auto_decided: false, created_at: '2026-06-23T07:59:57.878893+00:00', updated_at: '2026-06-23T07:59:57.801000+00:00' },
]

async function main() {
  let inserted = 0
  let skipped = 0
  for (const r of rows) {
    const found = await prisma.$queryRawUnsafe<{ business_id: string }[]>(
      `SELECT business_id::text FROM karute_records WHERE id = $1::uuid`,
      r.karute_record_id,
    )
    const businessId = found[0]?.business_id
    if (!businessId) {
      console.warn(`SKIP ${r.karute_record_id}: no core karute_records row → can't derive business_id`)
      skipped++
      continue
    }
    // Idempotent: ON CONFLICT DO NOTHING (the live app may already have upserted).
    const res = await prisma.$executeRawUnsafe(
      `INSERT INTO karute_outcomes
         (karute_record_id, business_id, customer_id, outcome, reason, is_first_visit, decided_by, decided_at, auto_decided, created_at, updated_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid,$8::timestamptz,$9,$10::timestamptz,$11::timestamptz)
       ON CONFLICT (karute_record_id) DO NOTHING`,
      r.karute_record_id, businessId, r.customer_id, r.outcome, r.reason, r.is_first_visit,
      r.decided_by, r.decided_at, r.auto_decided, r.created_at, r.updated_at,
    )
    console.log(`${res === 1 ? 'INSERT' : 'EXISTS'} ${r.karute_record_id} → business ${businessId} (${r.outcome})`)
    if (res === 1) inserted++
    else skipped++
  }
  const total = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM karute_outcomes`)
  console.log(`\nDone. inserted=${inserted} skipped/exists=${skipped}; core karute_outcomes total=${total[0].n}`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
