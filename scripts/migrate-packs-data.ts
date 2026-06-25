import { PrismaClient } from '@prisma/client'

// Cross-DB migration: read the 回数券 subsystem from the karute DB, write to core
// with business_id derived from the core customer. Idempotent (skipDuplicates).
const core = new PrismaClient()
const karute = new PrismaClient({
  datasources: { db: { url: process.env.KARUTE_DATABASE_URL } },
})

const d = (v: unknown): Date | null => (v == null ? null : new Date(v as string))

async function main() {
  // customer_id -> business_id map from core.
  const customers = await core.$queryRawUnsafe<{ id: string; business_id: string }[]>(
    `SELECT id::text, business_id::text FROM customers`,
  )
  const bizOf = new Map(customers.map((c) => [c.id, c.business_id]))
  const miss = new Set<string>()
  const biz = (cid: string): string | null => {
    const b = bizOf.get(cid)
    if (!b) miss.add(cid)
    return b ?? null
  }

  // ── ticket_packs ──
  const packs = await karute.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM ticket_packs`)
  const packData = packs
    .map((p) => {
      const b = biz(p.customer_id as string)
      return b && {
        id: p.id as string, businessId: b, customerId: p.customer_id as string,
        kind: p.kind as string, packSize: p.pack_size as number, unitPrice: p.unit_price as number,
        totalPrice: (p.total_price as number) ?? null, purchaseRound: (p.purchase_round as number) ?? 0,
        purchasedAt: d(p.purchased_at), source: p.source as string, status: p.status as string,
        notes: (p.notes as string) ?? null, createdBy: (p.created_by as string) ?? null,
        createdAt: d(p.created_at)!, updatedAt: d(p.updated_at)!,
      }
    })
    .filter(Boolean) as object[]
  const pr = await core.ticketPack.createMany({ data: packData as never, skipDuplicates: true })

  // ── pack_redemptions ──
  const reds = await karute.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM pack_redemptions`)
  const redData = reds
    .map((r) => {
      const b = biz(r.customer_id as string)
      return b && {
        id: r.id as string, businessId: b, packId: r.pack_id as string, customerId: r.customer_id as string,
        redeemedOn: d(r.redeemed_on)!, appointmentId: (r.appointment_id as string) ?? null,
        karuteRecordId: (r.karute_record_id as string) ?? null, source: r.source as string,
        createdBy: (r.created_by as string) ?? null, createdAt: d(r.created_at)!,
      }
    })
    .filter(Boolean) as object[]
  const rr = await core.packRedemption.createMany({ data: redData as never, skipDuplicates: true })

  // ── customer_lifecycle ──
  const lifes = await karute.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM customer_lifecycle`)
  const lifeData = lifes
    .map((l) => {
      const b = biz(l.customer_id as string)
      return b && {
        customerId: l.customer_id as string, businessId: b, status: l.status as string,
        referral: !!l.referral, statusChangedAt: d(l.status_changed_at), reason: (l.reason as string) ?? null,
        updatedBy: (l.updated_by as string) ?? null, updatedAt: d(l.updated_at)!,
      }
    })
    .filter(Boolean) as object[]
  const lr = await core.customerLifecycle.createMany({ data: lifeData as never, skipDuplicates: true })

  console.log(`ticket_packs: ${pr.count}/${packs.length} inserted`)
  console.log(`pack_redemptions: ${rr.count}/${reds.length} inserted`)
  console.log(`customer_lifecycle: ${lr.count}/${lifes.length} inserted`)
  if (miss.size) console.warn(`\n⚠️ ${miss.size} customer_id(s) had NO core customer (rows skipped):`, [...miss])
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(async () => { await core.$disconnect(); await karute.$disconnect() })
