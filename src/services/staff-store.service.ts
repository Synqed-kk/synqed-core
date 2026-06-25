import { prisma } from '../db/client.js'

/** Resolve a staff identifier to the canonical core staff id. Accepts either the
 *  core staff.id OR the karute profile id (= staff.user_id), so callers that
 *  live in profile-id space (the karute app) work transparently. */
async function resolveStaffId(businessId: string, idOrUserId: string): Promise<string | null> {
  const staff = await prisma.staff.findFirst({
    where: { businessId, OR: [{ id: idOrUserId }, { userId: idOrUserId }] },
    select: { id: true },
  })
  return staff?.id ?? null
}

/** The store ids a staff member is assigned to (empty = works in every store). */
export async function getStaffStores(businessId: string, staffId: string): Promise<string[]> {
  const resolved = await resolveStaffId(businessId, staffId)
  if (!resolved) return []
  const rows = await prisma.staffStore.findMany({
    where: { businessId, staffId: resolved },
    select: { storeId: true },
  })
  return rows.map((r) => r.storeId)
}

/** Reconcile a staff member's store links. Validates the staff + every store
 *  belong to the business, then upserts the wanted links and removes the rest —
 *  all in ONE DB transaction, so a partial failure can never leave the staff in
 *  a corrupted "works everywhere" state (an improvement over the karute version). */
export async function setStaffStores(
  businessId: string,
  staffId: string,
  storeIds: string[],
): Promise<{ ok: true }> {
  const resolved = await resolveStaffId(businessId, staffId)
  if (!resolved) throw new Error('Staff not found')

  const wanted = Array.from(new Set(storeIds))
  if (wanted.length > 0) {
    const valid = await prisma.store.findMany({
      where: { businessId, id: { in: wanted } },
      select: { id: true },
    })
    if (valid.length !== wanted.length) throw new Error('Store not found')
  }

  await prisma.$transaction([
    ...wanted.map((storeId) =>
      prisma.staffStore.upsert({
        where: { staffId_storeId: { staffId: resolved, storeId } },
        create: { staffId: resolved, storeId, businessId },
        update: {},
      }),
    ),
    prisma.staffStore.deleteMany({
      where: {
        businessId,
        staffId: resolved,
        ...(wanted.length > 0 ? { storeId: { notIn: wanted } } : {}),
      },
    }),
  ])
  return { ok: true }
}

/** Per-store staff counts for the business (a staff in N stores counts in each). */
export async function staffCountsByStore(businessId: string): Promise<Record<string, number>> {
  const rows = await prisma.staffStore.groupBy({
    by: ['storeId'],
    where: { businessId },
    _count: { storeId: true },
  })
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.storeId] = r._count.storeId
  return counts
}
