import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import { cleanupTestData, seedTestCustomer, seedTestStaff, seedTestKaruteRecord, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

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

let seedSeq = 0
async function seedRecord() {
  const staff = await seedTestStaff()
  const customer = await seedTestCustomer({ email: `outcome-${++seedSeq}@ex.com` })
  const rec = await seedTestKaruteRecord({ staffId: staff.id, customerId: customer.id })
  return { staff, customer, rec }
}

afterEach(async () => {
  await testPrisma.karuteOutcome.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('karute outcomes phase 2', () => {
  it('decision_context round-trips end to end like reason; invalid values null out', async () => {
    const { rec } = await seedRecord()
    const up = await (
      await req('PUT', '/karute-outcomes', {
        karute_record_id: rec.id, outcome: 'pending', decision_context: 'conversion',
      })
    ).json()
    expect(up.decision_context).toBe('conversion')

    const got = await (await req('GET', `/karute-outcomes/${rec.id}`)).json()
    expect(got.decision_context).toBe('conversion')

    // re-upsert switches it (repurchase question set)
    const re = await (
      await req('PUT', '/karute-outcomes', {
        karute_record_id: rec.id, outcome: 'revisit', decision_context: 'repurchase',
      })
    ).json()
    expect(re.decision_context).toBe('repurchase')
    expect(re.outcome).toBe('revisit') // plain-text outcome: 'revisit' just works

    // junk context → null, not error
    const junk = await (
      await req('PUT', '/karute-outcomes', {
        karute_record_id: rec.id, outcome: 'pending', decision_context: 'weird',
      })
    ).json()
    expect(junk.decision_context).toBeNull()
  })

  it('list filters by outcome + decision_context + age — the auto-close cron query', async () => {
    const a = await seedRecord()
    const b = await seedRecord()
    const c = await seedRecord()
    await req('PUT', '/karute-outcomes', { karute_record_id: a.rec.id, outcome: 'pending', decision_context: 'conversion' })
    await req('PUT', '/karute-outcomes', { karute_record_id: b.rec.id, outcome: 'pending', decision_context: 'repurchase' })
    await req('PUT', '/karute-outcomes', { karute_record_id: c.rec.id, outcome: 'success', decision_context: 'conversion' })

    // age the first row 15 days back (raw update — updatedAt is @updatedAt)
    await testPrisma.$executeRawUnsafe(
      `UPDATE karute_outcomes SET updated_at = now() - interval '15 days' WHERE karute_record_id = '${a.rec.id}'`,
    )

    const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
    const cron = await (
      await req('GET', `/karute-outcomes?outcome=pending&decision_context=conversion&updated_before=${encodeURIComponent(cutoff)}`)
    ).json()
    expect(cron.total).toBe(1)
    expect(cron.outcomes[0].karute_record_id).toBe(a.rec.id)

    const allPending = await (await req('GET', '/karute-outcomes?outcome=pending')).json()
    expect(allPending.total).toBe(2)

    const bad = await req('GET', '/karute-outcomes?updated_before=not-a-date')
    expect(bad.status).toBe(400)
  })

  it('listRecentRedemptions rows carry id (the correction handle)', async () => {
    const customer = await seedTestCustomer()
    const pack = await (
      await req('POST', '/packs', { customer_id: customer.id, kind: '回数券', pack_size: 10, unit_price: 5000 })
    ).json()
    const { id: redemptionId } = await (
      await req('POST', '/packs/redemptions', {
        pack_id: pack.id, customer_id: customer.id, redeemed_on: '2026-08-09',
      })
    ).json()

    const recent = await (await req('GET', '/packs/redemptions/recent?since=2026-08-01')).json()
    const row = recent.redemptions.find((r: { id: string }) => r.id === redemptionId)
    expect(row).toBeTruthy()
    expect(row.pack_id).toBe(pack.id)

    // and the handle actually works for the remove+recreate correction
    const removed = await (await req('DELETE', `/packs/redemptions/${row.id}`)).json()
    expect(removed.ok).toBe(true)
  })
})
