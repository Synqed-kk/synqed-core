// CORE-43: one Quick Reserve config row PER STORE. Two stores of one business
// (代官山 = primary, 銀座) each crawl their own Quick Reserve store, stamp their
// own Karute store, and sweep only their own bookings.
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll, vi } from 'vitest'

process.env.SYNC_CRYPTO_KEY = randomBytes(32).toString('base64')

vi.mock('../src/services/quickreserve.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/quickreserve.js')>()),
  qrLogin: vi.fn(),
  qrGetReservations: vi.fn(),
}))

import app from '../src/index.js'
import { qrLogin, qrGetReservations, type QRReservation } from '../src/services/quickreserve.js'
import { decryptJson } from '../src/services/crypto.js'
import { dispatchCron } from '../src/services/sync.service.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_BUSINESS_ID, TEST_API_KEY } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}
function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  return app.request(`/v1/sync/quickreserve${path}`, init)
}

const DAIKANYAMA = '43430000-0000-4000-8000-0000000000da'
const GINZA = '43430000-0000-4000-8000-0000000000a1'
const FOREIGN = '43430000-0000-4000-8000-0000000000ff'
const OTHER_BUSINESS = '43430000-0000-4000-8000-00000000b0b0'
const QR = {
  [DAIKANYAMA]: { store_slug: 'daikanyama', store_id: 101 },
  [GINZA]: { store_slug: 'ginza', store_id: 202 },
}
const STAFF_NAME = 'テストスタッフ'

// Tomorrow 12:00 JST, inside a lookahead of 1 day.
const jstDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(d)
function tomorrowJst(hour: number): Date {
  const day = jstDay(new Date(Date.now() + 24 * 3600_000))
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+09:00`)
}

function reservation(id: number, qrStoreId: number, customerId: number, hour: number): QRReservation {
  const start = tomorrowJst(hour)
  return {
    id, store_id: qrStoreId, customer_id: customerId, treatment_course_id: 5, staff_id: 7, booth_id: 1,
    start_at: start.getTime(), end_at: start.getTime() + 3600_000, request: '', deleted: false,
    rid: `r${id}`, is_new_customer_flag: false, nominated_staff_id: null,
    resolvedCustomerId: customerId, resolvedCustomerName: `客${customerId}`,
    staff: { id: 7, name: STAFF_NAME, name_kana: '' },
    treatment_course: { id: 5, name: 'Visit', duration: 3600000, price: 5000 },
  }
}

// What each Quick Reserve store's feed returns, keyed by slug. Login to a slug
// in `failLogin` throws.
let feeds: Record<string, QRReservation[]>
let failLogin: Set<string>

beforeEach(async () => {
  feeds = {
    daikanyama: [reservation(1001, 101, 501, 11)],
    ginza: [reservation(2001, 202, 601, 13)],
  }
  failLogin = new Set()
  vi.mocked(qrLogin).mockReset().mockImplementation(async (slug) => {
    if (failLogin.has(slug)) throw new Error(`QR login failed: 401 ${slug}`)
    return { token: slug, cookies: '' }
  })
  vi.mocked(qrGetReservations).mockReset().mockImplementation(async (_s, slug, _id, date) =>
    (feeds[slug] ?? []).filter((r) => jstDay(new Date(r.start_at)) === date),
  )
  await cleanup()
  await testPrisma.store.createMany({
    data: [
      { id: DAIKANYAMA, businessId: TEST_BUSINESS_ID, name: '代官山', isPrimary: true },
      { id: GINZA, businessId: TEST_BUSINESS_ID, name: '銀座' },
      { id: FOREIGN, businessId: OTHER_BUSINESS, name: 'よその店' },
    ],
  })
  await seedTestStaff({ name: STAFF_NAME })
})

async function cleanup() {
  await testPrisma.syncConfig.deleteMany({ where: { businessId: { in: [TEST_BUSINESS_ID, OTHER_BUSINESS] } } })
  await testPrisma.store.deleteMany({ where: { id: { in: [DAIKANYAMA, GINZA, FOREIGN] } } })
  await cleanupTestData()
}
afterEach(cleanup)

async function putConfig(storeId: string, extra: Record<string, unknown> = {}) {
  const res = await req('PUT', '/config', {
    karute_store_id: storeId,
    username: 'owner',
    password: 'pw',
    ...QR[storeId as keyof typeof QR],
    enabled: true,
    lookahead_days: 1,
    business_hours_start: 0,
    business_hours_end: 24,
    ...extra,
  })
  expect(res.status).toBe(200)
  return res.json()
}
const loginsTo = (slug: string) => vi.mocked(qrLogin).mock.calls.filter((c) => c[0] === slug).length
const apptByQrId = (qrId: number) =>
  testPrisma.appointment.findFirstOrThrow({
    where: { businessId: TEST_BUSINESS_ID, externalRefs: { path: ['quickreserve', 'reservationId'], equals: qrId } },
  })

describe('PUT /config — one row per store', () => {
  it('keeps two rows for one business, one per store', async () => {
    await putConfig(DAIKANYAMA)
    await putConfig(GINZA)
    const rows = await testPrisma.syncConfig.findMany({ where: { businessId: TEST_BUSINESS_ID } })
    expect(rows.map((r) => [r.karuteStoreId, r.storeSlug, r.storeId]).sort()).toEqual([
      [GINZA, 'ginza', 202],
      [DAIKANYAMA, 'daikanyama', 101],
    ].sort())
  })

  it('400s without karute_store_id', async () => {
    const res = await req('PUT', '/config', { username: 'owner', password: 'pw', ...QR[DAIKANYAMA] })
    expect(res.status).toBe(400)
  })

  it("400s store_not_in_business for another business's store", async () => {
    const res = await req('PUT', '/config', { karute_store_id: FOREIGN, ...QR[GINZA] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'store_not_in_business' })
    expect(await testPrisma.syncConfig.count({ where: { businessId: TEST_BUSINESS_ID } })).toBe(0)
  })

  it('400s qr_store_required when a new row has no Quick Reserve store', async () => {
    const res = await req('PUT', '/config', { karute_store_id: GINZA, username: 'owner', password: 'pw' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'qr_store_required' })
  })

  it('400s qr_store_already_linked when a second store points at the same QR store', async () => {
    await putConfig(DAIKANYAMA)
    const res = await req('PUT', '/config', { karute_store_id: GINZA, ...QR[DAIKANYAMA] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'qr_store_already_linked' })
  })

  // Both stores, so any business-wide read (whichever row it happens to pick)
  // hands one of them the other's Quick Reserve store.
  it("a password-only PUT for 銀座 keeps 銀座's own QR store, never 代官山's (and the reverse)", async () => {
    await putConfig(DAIKANYAMA)
    await putConfig(GINZA)
    for (const [store, slug, qrId] of [[GINZA, 'ginza', 202], [DAIKANYAMA, 'daikanyama', 101]] as const) {
      const res = await req('PUT', '/config', { karute_store_id: store, password: `new-${slug}` })
      expect(res.status).toBe(200)
      const row = await testPrisma.syncConfig.findFirstOrThrow({ where: { karuteStoreId: store } })
      expect([row.storeSlug, row.storeId]).toEqual([slug, qrId])
      expect(decryptJson(row.credentialsEncrypted!)).toEqual({
        username: 'owner', password: `new-${slug}`, storeSlug: slug, storeId: qrId,
      })
    }
  })
})

describe('GET /configs and GET /config', () => {
  it('GET /configs returns both rows with no secrets', async () => {
    await putConfig(DAIKANYAMA)
    await putConfig(GINZA)
    const res = await req('GET', '/configs')
    expect(res.status).toBe(200)
    const { configs } = await res.json()
    expect(configs.map((c: { karute_store_id: string }) => c.karute_store_id)).toEqual([DAIKANYAMA, GINZA])
    expect(JSON.stringify(configs)).not.toContain('"pw"')
    for (const c of configs) {
      expect(c).not.toHaveProperty('password')
      expect(c).not.toHaveProperty('credentials_encrypted')
      expect(c).not.toHaveProperty('credentialsEncrypted')
    }
    expect(configs.every((c: { has_credentials: boolean }) => c.has_credentials)).toBe(true)
  })

  it("GET /config returns the primary store's row", async () => {
    await putConfig(GINZA) // older row, not primary
    await putConfig(DAIKANYAMA)
    const res = await req('GET', '/config')
    expect(res.status).toBe(200)
    expect((await res.json()).karute_store_id).toBe(DAIKANYAMA)
  })

  it('GET /config falls back to the only row, else 404', async () => {
    await putConfig(GINZA)
    expect((await (await req('GET', '/config')).json()).karute_store_id).toBe(GINZA)
    await testPrisma.store.update({ where: { id: DAIKANYAMA }, data: { isPrimary: false } })
    await putConfig(DAIKANYAMA)
    expect((await req('GET', '/config')).status).toBe(404)
  })
})

describe('POST /run', () => {
  it('each run stamps its own store on the appointments it writes', async () => {
    await putConfig(DAIKANYAMA)
    await putConfig(GINZA)
    expect((await req('POST', '/run', { karute_store_id: DAIKANYAMA })).status).toBe(200)
    expect((await req('POST', '/run', { karute_store_id: GINZA })).status).toBe(200)
    expect((await apptByQrId(1001)).storeId).toBe(DAIKANYAMA)
    expect((await apptByQrId(2001)).storeId).toBe(GINZA)
  })

  it('{ all: true } runs both rows; a failed first row still runs the second', async () => {
    await putConfig(DAIKANYAMA)
    await putConfig(GINZA)
    failLogin.add('daikanyama')
    const res = await req('POST', '/run', { all: true })
    expect(res.status).toBe(200)
    const { results } = await res.json()
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ karute_store_id: DAIKANYAMA, ok: false, error: 'QR login failed: 401 daikanyama' })
    expect(results[1]).toMatchObject({ karute_store_id: GINZA, ok: true, result: { created: 1 } })
    const daikanyama = await testPrisma.syncConfig.findFirstOrThrow({ where: { karuteStoreId: DAIKANYAMA } })
    expect(daikanyama.lastRunStatus).toBe('ERROR')
  })

  it("no body runs the primary store's row and answers the flat shape", async () => {
    await putConfig(GINZA)
    await putConfig(DAIKANYAMA)
    const res = await req('POST', '/run')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).not.toHaveProperty('results')
    expect(body).toMatchObject({ total_fetched: 1, created: 1, skipped_no_staff: 0, skipped_deleted: 0 })
    expect(loginsTo('daikanyama')).toBe(1)
    expect(loginsTo('ginza')).toBe(0)
  })

  it('no body answers 500 on failure, as today', async () => {
    await putConfig(DAIKANYAMA)
    failLogin.add('daikanyama')
    const res = await req('POST', '/run')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'QR login failed: 401 daikanyama' })
  })

  it("no config answers 500 'Sync config not found', as today", async () => {
    const res = await req('POST', '/run')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Sync config not found' })
  })
})

describe('orphan sweep is per store', () => {
  beforeEach(async () => {
    await putConfig(DAIKANYAMA)
    await putConfig(GINZA)
    await req('POST', '/run', { all: true })
    expect((await apptByQrId(1001)).status).toBe('SCHEDULED')
    expect((await apptByQrId(2001)).status).toBe('SCHEDULED')
  })

  it("a 代官山 run does not cancel 銀座's appointments", async () => {
    feeds.daikanyama = [reservation(1001, 101, 501, 11), reservation(1002, 101, 502, 15)]
    const res = await req('POST', '/run', { karute_store_id: DAIKANYAMA })
    expect((await res.json()).cancelled).toBe(0)
    expect((await apptByQrId(2001)).status).toBe('SCHEDULED')
  })

  it("a 銀座 run does not cancel 代官山's appointments", async () => {
    feeds.ginza = [reservation(2001, 202, 601, 13), reservation(2002, 202, 602, 16)]
    const res = await req('POST', '/run', { karute_store_id: GINZA })
    expect((await res.json()).cancelled).toBe(0)
    expect((await apptByQrId(1001)).status).toBe('SCHEDULED')
  })

  it("still cancels the run's own store's dropped booking", async () => {
    feeds.ginza = [reservation(2002, 202, 602, 16)]
    const res = await req('POST', '/run', { karute_store_id: GINZA })
    expect((await res.json()).cancelled).toBe(1)
    expect((await apptByQrId(2001)).status).toBe('CANCELLED')
    expect((await apptByQrId(1001)).status).toBe('SCHEDULED')
  })
})

describe('dispatchCron', () => {
  it('runs each enabled row exactly once, each with its own store', async () => {
    await putConfig(DAIKANYAMA)
    await putConfig(GINZA)
    const out = await dispatchCron()
    expect(out.dispatched).toBeGreaterThanOrEqual(2)
    expect(loginsTo('daikanyama')).toBe(1)
    expect(loginsTo('ginza')).toBe(1)
    expect((await apptByQrId(1001)).storeId).toBe(DAIKANYAMA)
    expect((await apptByQrId(2001)).storeId).toBe(GINZA)
  })
})

// =============================================================================
// Migration rehearsal: File A and File B applied with psql to a scratch
// database whose sync_configs has today's production shape (nullable
// karute_store_id, old unique still named after tenant_id).
// =============================================================================

const FILE_A = 'prisma/migrations/manual/2026-10-03-sync-config-per-store.sql'
const FILE_B = 'prisma/migrations/manual/2026-10-03-sync-config-drop-business-unique.sql'
const scratchDb = `core43_rehearsal_${randomUUID().replaceAll('-', '')}`
let adminUrl: string
let scratchUrl: string

function psql(url: string, args: string[], input?: string) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '--dbname', url, ...args], {
    input, encoding: 'utf8',
  })
  return { ok: r.status === 0, out: r.stdout, err: r.stderr }
}
const sql = (q: string) => {
  const r = psql(scratchUrl, ['-c', q])
  if (!r.ok) throw new Error(r.err)
  return r.out.trim()
}

const B1 = '43430000-0000-4000-8000-0000000000b1'
const B2 = '43430000-0000-4000-8000-0000000000b2'
const B1_PRIMARY = '43430000-0000-4000-8000-0000000001b1'

describe('migration rehearsal (psql, scratch database)', () => {
  beforeAll(() => {
    const source = new URL(process.env.DATABASE_URL ?? '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname)) {
      throw new Error('The CORE-43 rehearsal needs a local DATABASE_URL with CREATE DATABASE')
    }
    adminUrl = source.href
    if (!psql(adminUrl, ['-c', `CREATE DATABASE "${scratchDb}"`]).ok) throw new Error('createdb failed')
    source.pathname = `/${scratchDb}`
    scratchUrl = source.href
  })
  afterAll(() => {
    if (adminUrl) psql(adminUrl, ['-c', `DROP DATABASE IF EXISTS "${scratchDb}" WITH (FORCE)`])
  })

  beforeEach(() => {
    sql(`
      DROP TABLE IF EXISTS sync_configs, stores; DROP TYPE IF EXISTS "SyncProvider";
      CREATE TYPE "SyncProvider" AS ENUM ('QUICKRESERVE', 'SYNQED_RESERVE', 'SALON_BOARD', 'HOT_PEPPER');
      CREATE TABLE stores (id uuid PRIMARY KEY, business_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT false);
      CREATE UNIQUE INDEX stores_one_primary_per_business ON stores (business_id) WHERE is_primary;
      CREATE TABLE sync_configs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
        provider "SyncProvider" NOT NULL, karute_store_id uuid,
        updated_at timestamptz NOT NULL DEFAULT '2026-01-01');
      CREATE UNIQUE INDEX sync_configs_tenant_id_provider_key ON sync_configs (business_id, provider);
      INSERT INTO stores VALUES ('${B1_PRIMARY}', '${B1}', true), (gen_random_uuid(), '${B1}', false);
      INSERT INTO sync_configs (business_id, provider) VALUES ('${B1}', 'QUICKRESERVE');`)
  })

  it('File A backfills the primary store, sets NOT NULL, adds the named unique, keeps the old one', () => {
    const r = psql(scratchUrl, ['-f', FILE_A])
    expect(r.err).toBe('')
    expect(sql(`SELECT karute_store_id, updated_at > '2026-01-02' FROM sync_configs`)).toBe(`${B1_PRIMARY}|t`)
    expect(sql(`SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'sync_configs' AND column_name = 'karute_store_id'`)).toBe('NO')
    expect(sql(`SELECT contype FROM pg_constraint
      WHERE conname = 'sync_configs_business_id_provider_karute_store_id_key'`)).toBe('u')
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE indexname = 'sync_configs_tenant_id_provider_key'`)).toBe('1')
    // Idempotent: a second run changes nothing and does not fail.
    expect(psql(scratchUrl, ['-f', FILE_A]).ok).toBe(true)
  })

  it('File A raises and changes nothing when a config has no primary store', () => {
    sql(`INSERT INTO sync_configs (business_id, provider) VALUES ('${B2}', 'QUICKRESERVE')`)
    const r = psql(scratchUrl, ['-f', FILE_A])
    expect(r.ok).toBe(false)
    expect(r.err).toContain('1 row(s) still have no karute_store_id')
    // The backfill of B1 rolled back with the rest.
    expect(sql(`SELECT count(*) FROM sync_configs WHERE karute_store_id IS NULL`)).toBe('2')
    expect(sql(`SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'sync_configs' AND column_name = 'karute_store_id'`)).toBe('YES')
    expect(sql(`SELECT count(*) FROM pg_constraint
      WHERE conname = 'sync_configs_business_id_provider_karute_store_id_key'`)).toBe('0')
  })

  it('File B refuses to run before File A', () => {
    const r = psql(scratchUrl, ['-f', FILE_B])
    expect(r.ok).toBe(false)
    expect(r.err).toContain('apply File A first')
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE indexname = 'sync_configs_tenant_id_provider_key'`)).toBe('1')
  })

  it('File B drops the old unique INDEX (tenant_id name), says so, and is idempotent', () => {
    expect(psql(scratchUrl, ['-f', FILE_A]).ok).toBe(true)
    const r = psql(scratchUrl, ['-f', FILE_B])
    expect(r.ok).toBe(true)
    expect(r.err).toContain('dropped unique INDEX sync_configs_tenant_id_provider_key')
    // A second store's row now inserts; a duplicate triple still fails.
    sql(`INSERT INTO sync_configs (business_id, provider, karute_store_id)
      VALUES ('${B1}', 'QUICKRESERVE', gen_random_uuid())`)
    expect(() => sql(`INSERT INTO sync_configs (business_id, provider, karute_store_id)
      VALUES ('${B1}', 'QUICKRESERVE', '${B1_PRIMARY}')`)).toThrow(/duplicate key/)
    const again = psql(scratchUrl, ['-f', FILE_B])
    expect(again.ok).toBe(true)
    expect(again.err).toContain('nothing dropped')
  })

  it('File B drops the old unique when it is a CONSTRAINT (business_id name)', () => {
    sql(`DROP INDEX sync_configs_tenant_id_provider_key;
      ALTER TABLE sync_configs ADD CONSTRAINT sync_configs_business_id_provider_key UNIQUE (business_id, provider)`)
    expect(psql(scratchUrl, ['-f', FILE_A]).ok).toBe(true)
    const r = psql(scratchUrl, ['-f', FILE_B])
    expect(r.ok).toBe(true)
    expect(r.err).toContain('dropped unique CONSTRAINT sync_configs_business_id_provider_key')
    expect(sql(`SELECT conname FROM pg_constraint WHERE conrelid = 'sync_configs'::regclass AND contype = 'u'`))
      .toBe('sync_configs_business_id_provider_karute_store_id_key')
  })
})
