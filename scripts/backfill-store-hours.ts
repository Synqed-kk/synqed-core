import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { prisma } from '../src/db/client.js'
import { logEventIn } from '../src/services/audit.service.js'

const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const window = z.object({
  openMinute: z.number().int().min(0).max(1439),
  closeMinute: z.number().int().min(1).max(1440),
}).refine(w => w.openMinute < w.closeMinute)
const hours = z.object({ mon: window, tue: window, wed: window, thu: window, fri: window, sat: window, sun: window })
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/** Strict conversion of stored hours. Missing/invalid weekdays never acquire
 * invented defaults; the dry run reports them for human correction. */
export function convertOperatingHours(value: unknown) {
  const parsed = hours.safeParse(value)
  if (!parsed.success) return null
  return Object.fromEntries(days.map(day => [day, { open: time(parsed.data[day].openMinute), close: time(parsed.data[day].closeMinute) }]))
}

export async function backfillStoreHours(apply = false, businessId?: string) {
  const stores = await prisma.store.findMany({ where: businessId ? { businessId } : {}, select: { id: true, businessId: true }, orderBy: { id: 'asc' } })
  const results = []
  for (const store of stores) {
    results.push(await prisma.$transaction(async tx => {
      // Same lock order as policy.set: read the latest target after locking it.
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${store.id}::uuid FOR UPDATE`
      const policy = await tx.storeBookingPolicy.findFirst({ where: { storeId: store.id, businessId: store.businessId } })
      const base = { business_id: store.businessId, store_id: store.id }
      if (policy?.weeklyHours != null) return { ...base, status: 'configured' }
      const org = await tx.orgSettings.findUnique({ where: { businessId: store.businessId } })
      const settings = z.object({ operating_hours: z.unknown() }).safeParse(org?.settings)
      const weeklyHours = convertOperatingHours(settings.success ? settings.data.operating_hours : undefined)
      if (!weeklyHours) return { ...base, status: 'missing_or_invalid_hours' }
      if (!apply) return { ...base, status: 'would_update', weekly_hours: weeklyHours }
      await tx.storeBookingPolicy.upsert({ where: { storeId: store.id },
        create: { businessId: store.businessId, storeId: store.id, weeklyHours },
        update: { weeklyHours, updatedBy: null },
      })
      await logEventIn(tx, store.businessId, { actor_type: 'system', category: 'settings', action: 'store_policy.hours_backfill',
        store_id: store.id, target_type: 'store_booking_policy', target_id: store.id, detail: { weekly_hours: weeklyHours } })
      return { ...base, status: 'updated', weekly_hours: weeklyHours }
    }))
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const businessArg = args.indexOf('--business')
  const businessId = businessArg >= 0 ? z.string().uuid().parse(args[businessArg + 1]) : undefined
  backfillStoreHours(args.includes('--apply'), businessId)
    .then(rows => console.log(JSON.stringify(rows, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
