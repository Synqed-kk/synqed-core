// Entry editing core (the pencil): in-place edit with optimistic concurrency,
// provenance (author + original_ai_content), soft delete, parent touch, the
// append-only karute_entry_edits audit trail, and the edited_summary overlay.
import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestStaff,
  seedTestCustomer,
  testPrisma,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}
function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

afterEach(async () => {
  await testPrisma.karuteEntryEdit.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

async function seedRecordWithAiEntry() {
  const staff = await seedTestStaff()
  const customer = await seedTestCustomer({ email: 'pencil@ex.com' })
  const rec = await (
    await req('POST', '/karute-records', {
      staff_id: staff.id,
      customer_id: customer.id,
      ai_summary: 'AI summary v1',
      entries: [{ category: 'SYMPTOM', content: '肩こり（AI抽出）', is_manual: false }],
    })
  ).json()
  return { staff, customer, rec, entry: rec.entries[0] }
}

describe('entry editing core', () => {
  it('updateEntry edits in place: same id, version bump, AI→HUMAN_EDITED, original preserved, audit row, parent touched', async () => {
    const { staff, rec, entry } = await seedRecordWithAiEntry()
    expect(entry.author).toBe('AI')
    expect(entry.version).toBe(1)
    const parentBefore = (await req('GET', `/karute-records/${rec.id}`)).headers && rec.updated_at

    const res = await req('PATCH', `/karute-records/${rec.id}/entries/${entry.id}`, {
      content: '肩こり — 右肩のみ、デスクワーク由来（スタッフ修正）',
      expected_version: 1,
      actor_staff_id: staff.id,
    })
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(updated.id).toBe(entry.id) // in place — history intact
    expect(updated.version).toBe(2)
    expect(updated.author).toBe('HUMAN_EDITED')
    expect(updated.original_ai_content).toBe('肩こり（AI抽出）')

    // Second edit must NOT overwrite the captured original
    const res2 = await req('PATCH', `/karute-records/${rec.id}/entries/${entry.id}`, {
      content: 'さらに修正',
      expected_version: 2,
      actor_staff_id: staff.id,
    })
    expect((await res2.json()).original_ai_content).toBe('肩こり（AI抽出）')

    // Audit rows: EDIT with before/after + actor
    const edits = await (await req('GET', `/karute-records/entry-edits?karute_record_id=${rec.id}`)).json()
    const editRows = edits.entry_edits.filter((e: { action: string }) => e.action === 'EDIT')
    expect(editRows.length).toBe(2)
    expect(editRows[1].content_before).toBe('肩こり（AI抽出）')
    expect(editRows[1].actor_staff_id).toBe(staff.id)
    expect(editRows[1].author_before).toBe('AI')
    expect(editRows[1].author_after).toBe('HUMAN_EDITED')

    // Parent anchor bumped
    const after = await (await req('GET', `/karute-records/${rec.id}`)).json()
    expect(after.updated_at > parentBefore).toBe(true)
  })

  it('stale expected_version → 409 with current_version', async () => {
    const { staff, rec, entry } = await seedRecordWithAiEntry()
    await req('PATCH', `/karute-records/${rec.id}/entries/${entry.id}`, {
      content: 'first edit',
      expected_version: 1,
      actor_staff_id: staff.id,
    })
    const stale = await req('PATCH', `/karute-records/${rec.id}/entries/${entry.id}`, {
      content: 'concurrent edit from a stale editor',
      expected_version: 1,
      actor_staff_id: staff.id,
    })
    expect(stale.status).toBe(409)
    expect((await stale.json()).current_version).toBe(2)
  })

  it('deleteEntry soft-deletes: hidden from reads, row survives, audit row written', async () => {
    const { staff, rec, entry } = await seedRecordWithAiEntry()
    const res = await req(
      'DELETE',
      `/karute-records/${rec.id}/entries/${entry.id}?actor_staff_id=${staff.id}`,
    )
    expect(res.status).toBe(200)

    const read = await (await req('GET', `/karute-records/${rec.id}`)).json()
    expect(read.entries).toHaveLength(0)

    const rowStillThere = await testPrisma.karuteEntry.findUnique({ where: { id: entry.id } })
    expect(rowStillThere?.deletedAt).not.toBeNull()

    const edits = await (await req('GET', `/karute-records/entry-edits?karute_record_id=${rec.id}`)).json()
    const del = edits.entry_edits.find((e: { action: string }) => e.action === 'DELETE')
    expect(del.content_before).toBe('肩こり（AI抽出）')
    expect(del.actor_staff_id).toBe(staff.id)
  })

  it('addEntry (manual) → HUMAN_CREATED + CREATE audit row', async () => {
    const { staff, rec } = await seedRecordWithAiEntry()
    const res = await req('POST', `/karute-records/${rec.id}/entries`, {
      category: 'PREFERENCE',
      content: '枕は低め希望（スタッフ追記）',
      is_manual: true,
      actor_staff_id: staff.id,
    })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.author).toBe('HUMAN_CREATED')

    const edits = await (await req('GET', `/karute-records/entry-edits?karute_record_id=${rec.id}`)).json()
    const row = edits.entry_edits.find((e: { action: string }) => e.action === 'CREATE')
    expect(row.entry_id_new).toBe(created.id)
    expect(row.author_after).toBe('HUMAN_CREATED')
  })

  it('regen (update {entries}) logs ONE batch: removed rows + created rows share batch_id with prompt/model stamps', async () => {
    const { staff, rec } = await seedRecordWithAiEntry()
    const res = await req('PUT', `/karute-records/${rec.id}`, {
      entries: [
        { category: 'SYMPTOM', content: '肩こり（再生成v2）', is_manual: false },
        { category: 'TREATMENT', content: 'ホットストーン60分（再生成v2）', is_manual: false },
      ],
      actor_staff_id: staff.id,
      prompt_version: 'karute-extract-v3.3',
      model: 'claude-sonnet-5',
    })
    expect(res.status).toBe(200)

    const edits = await (await req('GET', `/karute-records/entry-edits?karute_record_id=${rec.id}`)).json()
    const regen = edits.entry_edits.filter((e: { action: string }) => e.action === 'REGEN_REPLACE')
    expect(regen).toHaveLength(3) // 1 removed + 2 created
    const batchIds = new Set(regen.map((e: { batch_id: string }) => e.batch_id))
    expect(batchIds.size).toBe(1) // one regen = one batch
    expect(regen[0].prompt_version).toBe('karute-extract-v3.3')
    expect(regen[0].model).toBe('claude-sonnet-5')
  })

  it('edited_summary: human overlay survives an ai_summary regen; AI path never writes it', async () => {
    const { staff, rec } = await seedRecordWithAiEntry()
    // The pencil writes the overlay
    await req('PUT', `/karute-records/${rec.id}`, {
      edited_summary: '要約の人間修正版',
      actor_staff_id: staff.id,
    })
    // Regen keeps writing ai_summary only
    await req('PUT', `/karute-records/${rec.id}`, { ai_summary: 'AI summary v2 (regen)' })

    const read = await (await req('GET', `/karute-records/${rec.id}`)).json()
    expect(read.ai_summary).toBe('AI summary v2 (regen)')
    expect(read.edited_summary).toBe('要約の人間修正版')

    // Summary edit audited as a record-level row (entry ids null)
    const edits = await (await req('GET', `/karute-records/entry-edits?karute_record_id=${rec.id}`)).json()
    const summaryEdit = edits.entry_edits.find(
      (e: { action: string; entry_id_old: string | null; entry_id_new: string | null }) =>
        e.action === 'EDIT' && e.entry_id_old === null && e.entry_id_new === null,
    )
    expect(summaryEdit.content_after).toBe('要約の人間修正版')
  })

  it('customer deletion cascades into karute_entry_edits (privacy lineage)', async () => {
    const { customer, rec, entry } = await seedRecordWithAiEntry()
    await req('PATCH', `/karute-records/${rec.id}/entries/${entry.id}`, {
      content: 'edit before customer deletion',
      expected_version: 1,
    })
    const before = await testPrisma.karuteEntryEdit.count({
      where: { customerId: customer.id },
    })
    expect(before).toBeGreaterThan(0)
    await req('DELETE', `/customers/${customer.id}`)
    const after = await testPrisma.karuteEntryEdit.count({
      where: { customerId: customer.id },
    })
    expect(after).toBe(0)
  })
})
