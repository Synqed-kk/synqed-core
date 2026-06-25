import { prisma } from '../db/client.js'

export interface EntitlementPublic {
  business_id: string
  tier: string
  is_unlimited: boolean
}

/** The business's entitlement row. Absent = the 'free' default (1 store). */
export async function getEntitlement(businessId: string): Promise<EntitlementPublic> {
  const row = await prisma.businessEntitlement.findUnique({ where: { businessId } })
  return {
    business_id: businessId,
    tier: row?.tier ?? 'free',
    is_unlimited: row?.isUnlimited ?? false,
  }
}

export async function upsertEntitlement(
  businessId: string,
  input: { tier?: string; is_unlimited?: boolean },
): Promise<EntitlementPublic> {
  const row = await prisma.businessEntitlement.upsert({
    where: { businessId },
    create: {
      businessId,
      tier: input.tier ?? 'free',
      isUnlimited: input.is_unlimited ?? false,
    },
    update: {
      ...(input.tier !== undefined ? { tier: input.tier } : {}),
      ...(input.is_unlimited !== undefined ? { isUnlimited: input.is_unlimited } : {}),
    },
  })
  return { business_id: businessId, tier: row.tier, is_unlimited: row.isUnlimited }
}
