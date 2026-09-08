import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import app from '../src/index.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'
import { normalizeKaruteStaffIdentities } from '../src/services/karute-staff-normalization.service.js'
import { deleteStaff, StaffAttributedRecordsError } from '../src/services/staff.service.js'

process.env.API_KEYS = TEST_API_KEY
const foreignBusiness = randomUUID()
const create = (staffId: string) => app.request('/v1/karute-records', {
  method: 'POST', headers: { 'x-api-key': TEST_API_KEY, 'x-business-id': TEST_BUSINESS_ID, 'content-type': 'application/json' },
  body: JSON.stringify({ staff_id: staffId, entries: [{ category: 'SYMPTOM', content: 'identity-test' }] }),
})

async function expectStaffLockWait(tx: Prisma.TransactionClient) {
  const deadline = Date.now() + 2_000
  let blocked = false
  while (Date.now() < deadline) {
    await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`
    const [row] = await tx.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query ILIKE '%staff%') AS blocked
    `
    if (row.blocked) { blocked = true; break }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  expect(blocked).toBe(true)
}

afterEach(async () => {
  await cleanupTestData()
  // Match the audit suite's test-only cleanup, retaining append-only behavior
  // throughout the repair itself and keeping later suite counts isolated.
  await testPrisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL app.audit_scrub = 'on'`
    await tx.auditLog.deleteMany({ where: { businessId: TEST_BUSINESS_ID, action: 'normalize_staff_identity' } })
  })
  await testPrisma.karuteRecord.deleteMany({ where: { businessId: foreignBusiness } })
  await testPrisma.staff.deleteMany({ where: { businessId: foreignBusiness } })
})

describe('CORE-4 karute owner identity', () => {
  it('stores the same permanent card for login and worker IDs', async () => {
    const staff = await seedTestStaff({ userId: randomUUID() })
    for (const input of [staff.userId!, staff.id]) {
      const response = await create(input)
      expect(response.status).toBe(201)
      const record = await response.json()
      expect(record.staff_id).toBe(staff.id)
      expect((await testPrisma.karuteRecord.findUniqueOrThrow({ where: { id: record.id } })).staffId).toBe(staff.id)
      expect(record.entries).toHaveLength(1)
    }
  })

  it('rejects unknown, foreign, and ambiguous identities without partial records', async () => {
    const foreign = await seedTestStaff({ businessId: foreignBusiness, userId: randomUUID() })
    const card = await seedTestStaff()
    await seedTestStaff({ userId: card.id })
    for (const input of [randomUUID(), foreign.id, foreign.userId!, card.id]) {
      expect((await create(input)).status).toBe(400)
    }
    expect(await testPrisma.karuteRecord.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it('preserves an inactive staff card for delayed historical writes', async () => {
    const staff = await seedTestStaff({ userId: randomUUID(), isActive: false })
    const response = await create(staff.userId!)
    expect(response.status).toBe(201)
    expect((await response.json()).staff_id).toBe(staff.id)
  })

  it('previews then repairs only the selected business, preserves content, and audits once', async () => {
    const staff = await seedTestStaff({ userId: randomUUID() })
    const original = await testPrisma.karuteRecord.create({ data: {
      businessId: TEST_BUSINESS_ID, staffId: staff.userId!, aiSummary: 'historical content',
      entries: { create: { category: 'SYMPTOM', content: 'preserved entry' } },
    }, include: { entries: true } })
    const foreign = await testPrisma.karuteRecord.create({ data: { businessId: foreignBusiness, staffId: staff.userId! } })
    expect(await normalizeKaruteStaffIdentities(TEST_BUSINESS_ID)).toMatchObject({ total: 1, changeable: 1, unresolved: 0, ambiguous: 0, changed: 0 })
    expect((await testPrisma.karuteRecord.findUniqueOrThrow({ where: { id: original.id } })).staffId).toBe(staff.userId)
    expect(await testPrisma.auditLog.count({ where: { targetId: original.id } })).toBe(0)
    expect((await normalizeKaruteStaffIdentities(TEST_BUSINESS_ID, true)).changed).toBe(1)
    expect(await testPrisma.karuteRecord.findUniqueOrThrow({ where: { id: original.id }, include: { entries: true } })).toEqual({ ...original, staffId: staff.id })
    expect(await testPrisma.karuteRecord.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign)
    expect((await normalizeKaruteStaffIdentities(TEST_BUSINESS_ID, true)).changed).toBe(0)
    const audits = await testPrisma.auditLog.findMany({ where: { targetId: original.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ businessId: TEST_BUSINESS_ID, action: 'normalize_staff_identity', detail: { previous_staff_id: staff.userId, staff_id: staff.id } })
  })

  it('refuses the whole repair for missing and ambiguous mappings', async () => {
    const priorAudits = await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID, action: 'normalize_staff_identity' } })
    const staff = await seedTestStaff({ userId: randomUUID() })
    const ambiguous = await seedTestStaff()
    await seedTestStaff({ userId: ambiguous.id })
    const unknown = randomUUID()
    await testPrisma.karuteRecord.createMany({ data: [staff.userId!, ambiguous.id, unknown].map(staffId => ({ businessId: TEST_BUSINESS_ID, staffId })) })
    const preview = await normalizeKaruteStaffIdentities(TEST_BUSINESS_ID)
    expect(preview).toMatchObject({ total: 3, changeable: 1, unresolved: 1, ambiguous: 1, changed: 0 })
    expect(preview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ staff_id: ambiguous.id, matches: 2 }),
      expect.objectContaining({ staff_id: unknown, matches: 0 }),
    ]))
    await expect(normalizeKaruteStaffIdentities(TEST_BUSINESS_ID, true)).rejects.toThrow('Normalization refused')
    expect(await testPrisma.karuteRecord.count({ where: { businessId: TEST_BUSINESS_ID, staffId: staff.userId! } })).toBe(1)
    expect(await testPrisma.auditLog.count({ where: { businessId: TEST_BUSINESS_ID, action: 'normalize_staff_identity' } })).toBe(priorAudits)
  })

  it('rejects a unique login whose permanent card is shadowed by another login', async () => {
    const staff = await seedTestStaff({ userId: randomUUID() })
    await seedTestStaff({ userId: staff.id })
    expect((await create(staff.userId!)).status).toBe(400)
    const legacy = await testPrisma.karuteRecord.create({ data: { businessId: TEST_BUSINESS_ID, staffId: staff.userId! } })
    expect(await normalizeKaruteStaffIdentities(TEST_BUSINESS_ID)).toMatchObject({ changeable: 0, ambiguous: 1 })
    await expect(normalizeKaruteStaffIdentities(TEST_BUSINESS_ID, true)).rejects.toThrow('Normalization refused')
    expect((await testPrisma.karuteRecord.findUniqueOrThrow({ where: { id: legacy.id } })).staffId).toBe(staff.userId)
  })

  it('rechecks ownership after waiting for a concurrent chart writer', async () => {
    const staff = await seedTestStaff()
    await seedTestStaff()
    let deletion: Promise<unknown> | undefined
    try {
      await testPrisma.$transaction(async tx => {
        await tx.$executeRaw`LOCK TABLE staff IN SHARE MODE`
        deletion = deleteStaff(TEST_BUSINESS_ID, staff.id).then(() => null, error => error)
        // Observe the real database wait rather than assuming a timer ordered
        // the deletion behind this writer. The old delete also waits here,
        // but only after reading an obsolete count of zero attributed charts.
        await expectStaffLockWait(tx)
        await tx.karuteRecord.create({ data: { businessId: TEST_BUSINESS_ID, staffId: staff.id } })
      })
      expect(await deletion).toBeInstanceOf(StaffAttributedRecordsError)
      expect(await testPrisma.staff.findUnique({ where: { id: staff.id } })).not.toBeNull()
    } finally {
      await deletion
    }
  })

  it('waits for a concurrent alias insertion before resolving the namespace', async () => {
    const staff = await seedTestStaff({ userId: randomUUID() })
    let pending: Promise<Response> | undefined
    try {
      await testPrisma.$transaction(async tx => {
        await tx.staff.create({ data: { businessId: TEST_BUSINESS_ID, name: 'alias', role: 'STYLIST', userId: staff.id } })
        pending = create(staff.userId!)
        await expectStaffLockWait(tx)
      })
      expect((await pending)?.status).toBe(400)
      expect(await testPrisma.karuteRecord.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
    } finally {
      await pending
    }
  })
})
