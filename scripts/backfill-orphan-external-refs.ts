/**
 * Item B — backfill QR external_refs onto orphaned MANUAL bookings.
 *
 * Some future MANUAL/imported appointments have external_refs = {} (no QR id),
 * so the crawl can't own them and markOrphanedCancelled (QUICKRESERVE-only)
 * never cancels them if they're dropped in QuickReserve. This matches each such
 * row to a live QR reservation by (JST date + exact starts_at), confirms the
 * customer, and stamps external_refs.quickreserve — the same shape the crawl
 * writes on adopt.
 *
 * DRY RUN by default: prints the proposed mapping and does nothing.
 *   SYNC_CRYPTO_KEY=<key> npx tsx scripts/backfill-orphan-external-refs.ts
 * Write it for real (guarded to empty-external_refs rows only):
 *   SYNC_CRYPTO_KEY=<key> npx tsx scripts/backfill-orphan-external-refs.ts --apply
 *
 * Env: DATABASE_URL (auto-loaded from .env) + SYNC_CRYPTO_KEY. The crypto key
 * is NOT in .env — it lives in the Vercel deploy env; export it from there to
 * decrypt the stored QUICKRESERVE credentials (exactly as the crawl does).
 * Reads one business's config; pass --business=<uuid> to override (defaults to
 * the sole business that has the orphans).
 */
import 'dotenv/config'
import { prisma } from '../src/db/client.js'
import { decryptJson } from '../src/services/crypto.js'
import { qrLogin, qrGetReservations, mapReservation } from '../src/services/quickreserve.js'

const APPLY = process.argv.includes('--apply')
const businessArg = process.argv.find((a) => a.startsWith('--business='))?.split('=')[1]

interface QRCredentials {
  username: string
  password: string
  storeSlug: string
  storeId: number
}

// JST calendar date (YYYY-MM-DD) for a UTC instant — QR's by-date feed is JST.
function jstDate(d: Date): string {
  // en-CA gives YYYY-MM-DD; Asia/Tokyo shifts the instant into JST first.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

async function main() {
  // 1. Orphans: future MANUAL rows with empty external_refs.
  const orphans = await prisma.$queryRawUnsafe<
    { id: string; business_id: string; customer_id: string; starts_at: Date }[]
  >(`
    select id, business_id, customer_id, starts_at
    from appointments
    where source = 'MANUAL' and starts_at > now()
      and (external_refs is null or external_refs = '{}'::jsonb)
    order by starts_at
  `)

  if (orphans.length === 0) {
    console.log('No orphaned MANUAL rows — nothing to do.')
    return
  }

  const businessId = businessArg ?? orphans[0].business_id
  const scoped = orphans.filter((o) => o.business_id === businessId)
  console.log(`${scoped.length} orphan(s) for business ${businessId}${APPLY ? '' : '  (DRY RUN)'}`)

  // 2. Load + decrypt the QUICKRESERVE credentials, log in.
  const config = await prisma.syncConfig.findUnique({
    where: { businessId_provider: { businessId, provider: 'QUICKRESERVE' } },
  })
  if (!config?.credentialsEncrypted) throw new Error('No QUICKRESERVE credentials for this business')
  const creds = decryptJson<QRCredentials>(config.credentialsEncrypted)
  const storeSlug = config.storeSlug ?? creds.storeSlug
  const storeId = config.storeId ?? creds.storeId
  if (!storeSlug || !storeId) throw new Error('Store slug / id missing from QR config')

  const session = await qrLogin(storeSlug, creds.username, creds.password)

  // 3. Fetch each distinct orphan date once, index reservations by exact startsAt.
  const dates = Array.from(new Set(scoped.map((o) => jstDate(o.starts_at))))
  const byStartMs = new Map<number, ReturnType<typeof mapReservation>[]>()
  for (const date of dates) {
    const raw = await qrGetReservations(session, storeSlug, storeId, date)
    for (const r of raw) {
      if (r.resolvedCustomerId == null) continue
      const m = mapReservation(r)
      const key = m.startsAt.getTime()
      const list = byStartMs.get(key) ?? []
      list.push(m)
      byStartMs.set(key, list)
    }
    console.log(`  fetched ${date}: ${raw.length} row(s)`)
  }

  // 4. Match each orphan by exact starts_at; confirm customer; propose a write.
  let matched = 0
  let wrote = 0
  for (const o of scoped) {
    const customer = await prisma.customer.findUnique({
      where: { id: o.customer_id },
      select: { name: true, externalRefs: true },
    })
    const knownQrCustomerId = (customer?.externalRefs as any)?.quickreserve?.customerId as
      | number
      | undefined

    const candidates = byStartMs.get(o.starts_at.getTime()) ?? []
    // Prefer an exact QR-customer-id match; fall back to the sole candidate.
    const hit =
      candidates.find((c) => knownQrCustomerId != null && c.qrCustomerId === knownQrCustomerId) ??
      (candidates.length === 1 ? candidates[0] : undefined)

    if (!hit) {
      console.log(
        `  ✗ ${o.id}  ${o.starts_at.toISOString()}  ${customer?.name ?? '?'} — ${candidates.length} candidate(s), no confident match`,
      )
      continue
    }
    matched++
    const custMatch = knownQrCustomerId != null && hit.qrCustomerId === knownQrCustomerId
    console.log(
      `  ✓ ${o.id}  ${o.starts_at.toISOString()}  ${customer?.name ?? '?'} → reservation ${hit.qrReservationId} (QR "${hit.customerName}"${custMatch ? ', id-confirmed' : ', time-only'})`,
    )

    if (APPLY) {
      const externalRefs = {
        quickreserve: {
          reservationId: hit.qrReservationId,
          rid: hit.qrRid,
          customerId: hit.qrCustomerId,
          staffId: hit.qrStaffId,
          treatmentId: hit.treatmentId,
        },
      }
      // Guard: only stamp rows that are still empty (idempotent, never clobber).
      const res = await prisma.appointment.updateMany({
        where: { id: o.id, OR: [{ externalRefs: { equals: {} } }, { externalRefs: { equals: null } }] },
        data: { externalRefs, source: 'QUICKRESERVE' },
      })
      if (res.count > 0) wrote++
    }
  }

  console.log(
    `\n${matched}/${scoped.length} matched.${APPLY ? ` ${wrote} written.` : ' DRY RUN — re-run with --apply to write.'}`,
  )
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
