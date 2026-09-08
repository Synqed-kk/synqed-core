import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// The migration names production UUIDs. Run it ONLY in a newly created, empty
// local database, with the test DB's schema (including its manual constraints).
const businessId = '7bb76aac-2947-47fb-b883-d85fe849ccec'
const dateCustomer = '1f92d3b9-dbe8-41a9-a4dd-74f58e0486bf'
const datePack = 'f9e96c87-539a-44fe-8612-3fa07cde3360'
const dateBurn = 'a779da15-2dbd-4262-8c98-5972ddf0310f'
const pairs = [
  ['52c38e11-50ca-42ce-bb62-6f90106a4ee1', '77f91da2-eb58-4098-8ad0-48eb1af7db63', 542, 297],
  ['f5b1935f-11c4-42f3-86c1-40fab956d043', 'd9fd622b-f0f6-44ae-89d6-943348b164b0', 499, 303],
  ['1a612ecf-6680-4ed1-a1b1-73f688eb1c5b', '3608aa06-97bf-41c5-955f-e7bf20941c61', 565, 322],
  ['068ab6af-73df-4578-a87f-b34680f6f8bd', 'd79d0867-e799-44f8-b40a-aba5f8f9707a', 492, 520],
  ['ddbf7811-5123-4244-9b39-6f21d9d9bb47', 'cc70b783-37a1-4f77-bf73-e43deac470e6', 429, 312],
  ['4ac94358-30ad-4b60-a526-0c462131d233', 'fbfe126d-8320-4229-8e1d-4cfb973cd19e', 108, 313],
  ['913b55f2-dd1c-469f-84fd-06580de4d914', '58c7d18a-94f1-41eb-86b9-57274975475c', 82, 302],
] as const
const packs = [
  ['1a6033cb-24fb-4fbd-9979-24f7f1782515', pairs[0][1], 6, 4],
  ['42139ad8-0a5c-43ad-94e5-2b11d67cc1f7', pairs[1][1], 10, 3],
  ['b4babe66-453f-4b7d-8c6a-e432674ad3da', pairs[2][1], 6, 5],
  ['e0bbeef7-0820-49f6-9f6f-aae7de88670d', pairs[2][0], 6, 1],
  ['073b1aef-771c-43f6-9d44-4c397db51238', pairs[4][1], 10, 5],
  ['9b35d65a-e139-4a53-8aaa-8b95e63645e3', pairs[5][1], 20, 7],
  ['a1fbdaa3-af9b-4aff-911d-5aa90756e606', pairs[6][1], 10, 8],
  ['87c9cb75-5740-473f-86cc-ca6fbe66d9a3', pairs[6][0], 6, 5],
  [datePack, dateCustomer, 6, 6],
] as const
const migration = readFileSync('prisma/migrations/manual/2026-09-08-core-5-customer-merges.sql', 'utf8')
let db: PrismaClient
let adminUrl: string
let isolatedUrl: string
let created = false
const databaseName = `core5_test_${randomUUID().replaceAll('-', '')}`
function sql(input: string, url = isolatedUrl) {
  return execFileSync('psql', ['-X', '--dbname', url, '--set', 'ON_ERROR_STOP=1', '-At'], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  })
}
function apply() { sql(migration) }

beforeAll(async () => {
  const source = new URL(process.env.DATABASE_URL ?? '')
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname)) {
    throw new Error('CORE-5 migration tests require a local DATABASE_URL and CREATE DATABASE privilege')
  }
  const schema = execFileSync('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', source.href], { encoding: 'utf8' })
  adminUrl = source.href
  sql(`CREATE DATABASE "${databaseName}"`, adminUrl)
  created = true
  source.pathname = `/${databaseName}`
  isolatedUrl = source.href
  sql(schema)
  db = new PrismaClient({ datasourceUrl: isolatedUrl })
})
afterAll(async () => {
  await db?.$disconnect()
  if (created) sql(`DROP DATABASE "${databaseName}" WITH (FORCE)`, adminUrl)
})
beforeEach(async () => {
  sql(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
      EXECUTE format('TRUNCATE TABLE public.%I CASCADE',r.tablename);
    END LOOP;
  END $$;`)
  for (const [keep, fold, keepNumber, foldNumber] of pairs) {
    await db.customer.createMany({ data: [
      { id: keep, businessId, name: 'Live booking record', karuteNumber: keepNumber, externalRefs: { quickreserve: keep } },
      { id: fold, businessId, name: 'Imported history', karuteNumber: foldNumber, externalRefs: { import: fold } },
    ] })
  }
  await db.customer.create({ data: { id: dateCustomer, businessId, name: 'Date correction', karuteNumber: 287 } })
  for (const [id, customerId, packSize, burns] of packs) {
    await db.ticketPack.create({ data: { id, businessId, customerId, kind: 'pack', packSize,
      unitPrice: 8000, totalPrice: packSize * 8000, purchaseRound: 2, status: 'active', source: 'import',
      notes: 'Keep this provenance', purchasedAt: new Date(id === datePack ? '2026-12-25' : '2026-06-11') } })
    for (let i = 0; i < burns; i++) {
      await db.packRedemption.create({ data: { businessId, customerId, packId: id,
        ...(id === datePack && i === 0 ? { id: dateBurn } : {}),
        redeemedOn: new Date(id === datePack && i === 0 ? '2026-12-25' : `2026-01-${10 + i}`), source: 'import' } })
    }
  }
  // Include an undone burn: merging may not resurrect it or change its data.
  await db.packRedemption.create({ data: { businessId, customerId: pairs[0][1], packId: packs[0][0],
    redeemedOn: new Date('2026-01-08'), removedAt: new Date('2026-01-09') } })
  const staff = await db.staff.create({ data: { businessId, name: 'Test staff', role: 'STYLIST' } })
  for (const [keep, fold] of pairs) {
    for (const customerId of [keep, fold]) {
      await db.appointment.create({ data: { businessId, customerId, staffId: staff.id,
        startsAt: new Date('2026-07-09T04:00:00Z'), endsAt: new Date('2026-07-09T05:00:00Z'),
        status: 'CANCELLED', statusReason: 'contacted' } })
      await db.customerMemoryItem.create({ data: { businessId, customerId, category: 'history', label: 'History', detail: 'Preserve me' } })
      await db.customerLifecycle.create({ data: { businessId, customerId, status: 'active', reason: 'Provenance' } })
    }
  }
})

describe('CORE-5 exact manual migration', () => {
  it('moves history, preserves all money and undo state, corrects dates, and reruns without changes', async () => {
    const unrelated = await db.customer.create({ data: { businessId: randomUUID(), name: 'Unrelated customer' } })
    const oldPacks = await db.ticketPack.findMany({ orderBy: { id: 'asc' } })
    const oldBurns = await db.packRedemption.findMany({ orderBy: { id: 'asc' } })
    const oldBookings = await db.appointment.findMany({ orderBy: { id: 'asc' } })
    const canonical = (id: string) => pairs.find(pair => pair[1] === id)?.[0] ?? id
    apply()
    for (const pack of oldPacks) {
      const actual = await db.ticketPack.findUniqueOrThrow({ where: { id: pack.id } })
      expect(actual).toEqual(pack.id === datePack ? { ...pack, purchasedAt: new Date('2025-12-25'), status: 'exhausted', updatedAt: actual.updatedAt }
        : { ...pack, customerId: canonical(pack.customerId) })
    }
    expect(await db.packRedemption.findMany({ orderBy: { id: 'asc' } })).toEqual(oldBurns.map(burn => ({ ...burn,
      customerId: canonical(burn.customerId), redeemedOn: burn.id === dateBurn ? new Date('2025-12-25') : burn.redeemedOn })))
    expect(await db.appointment.findMany({ orderBy: { id: 'asc' } })).toEqual(oldBookings.map(row => ({ ...row, customerId: canonical(row.customerId!) })))
    for (const [keep, fold] of pairs) {
      expect((await db.customer.findUniqueOrThrow({ where: { id: fold } })).deletedAt).not.toBeNull()
      expect((await db.customer.findUniqueOrThrow({ where: { id: keep } })).deletedAt).toBeNull()
      expect(await db.customerMemoryItem.count({ where: { customerId: keep } })).toBe(2)
      expect(await db.customerMemoryItem.count({ where: { customerId: fold } })).toBe(0)
    }
    expect(await db.customer.findUnique({ where: { id: unrelated.id } })).toEqual(unrelated)
    const customers = await db.customer.findMany({ orderBy: { id: 'asc' } })
    const audit = await db.auditLog.findMany({ orderBy: { id: 'asc' } })
    expect(audit).toHaveLength(8)
    apply()
    expect(await db.customer.findMany({ orderBy: { id: 'asc' } })).toEqual(customers)
    expect(await db.auditLog.findMany({ orderBy: { id: 'asc' } })).toEqual(audit)
  })

  it('aborts the whole repair if an expected balance has changed', async () => {
    await db.packRedemption.create({ data: { businessId, customerId: pairs[0][1], packId: packs[0][0], redeemedOn: new Date('2026-09-09') } })
    expect(apply).toThrow('pack/burn precondition failed')
    expect(await db.customer.count({ where: { deletedAt: { not: null } } })).toBe(0)
    expect(await db.auditLog.count()).toBe(0)
    expect((await db.ticketPack.findUniqueOrThrow({ where: { id: datePack } })).purchasedAt).toEqual(new Date('2026-12-25'))
  })

  it('refuses to guess conflicting external identities', async () => {
    await db.customer.update({ where: { id: pairs[0][1] }, data: { externalRefs: { quickreserve: 'different-login' } } })
    expect(apply).toThrow('external reference conflict')
    expect(await db.auditLog.count()).toBe(0)
  })

  it('refuses an unhandled customer foreign key even under a different column name', async () => {
    sql('CREATE TABLE future_customer_links (person uuid REFERENCES customers(id))')
    try {
      sql(`INSERT INTO future_customer_links VALUES ('${pairs[0][1]}')`)
      expect(apply).toThrow('unmapped dependency future_customer_links.person')
      expect(await db.auditLog.count()).toBe(0)
    } finally { sql('DROP TABLE future_customer_links') }
  })
})
