import type { Prisma } from '@prisma/client'

/**
 * Shared serialization point for appointment acceptance and store-schedule
 * mutations. Readers hold SHARE through the appointment write; policy and
 * closed-day writers hold UPDATE through their mutation.
 */
export async function lockStoreScheduleForRead(
  tx: Prisma.TransactionClient,
  businessId: string,
  storeId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM stores
    WHERE id = ${storeId}::uuid AND business_id = ${businessId}::uuid
    FOR SHARE
  `
  return rows.length > 0
}

export async function lockStoreScheduleForWrite(
  tx: Prisma.TransactionClient,
  businessId: string,
  storeId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM stores
    WHERE id = ${storeId}::uuid AND business_id = ${businessId}::uuid
    FOR UPDATE
  `
  return rows.length > 0
}
