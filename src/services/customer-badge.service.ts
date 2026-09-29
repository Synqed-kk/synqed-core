import { prisma } from '../db/client.js'
import { logEventIn } from './audit.service.js'

export type StaffBadgeDefinition = { name: string; colour: string; display_order: number }
export const DEFAULT_STAFF_BADGES: StaffBadgeDefinition[] = [
  { name: '個室希望', colour: '#2563eb', display_order: 0 },
  { name: '要注意', colour: '#dc2626', display_order: 1 },
]

export async function getStaffBadgeDefinitions(businessId: string) {
  const row = await prisma.orgSettings.findUnique({ where: { businessId }, select: { staffBadgeDefinitions: true } })
  const badges = row ? row.staffBadgeDefinitions as StaffBadgeDefinition[] : DEFAULT_STAFF_BADGES
  return [...badges].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
}

export async function setStaffBadgeDefinitions(businessId: string, badges: StaffBadgeDefinition[], actorId: string) {
  await prisma.$transaction(async tx => {
    await tx.orgSettings.upsert({ where: { businessId },
      create: { businessId, staffBadgeDefinitions: badges }, update: { staffBadgeDefinitions: badges },
    })
    await logEventIn(tx, businessId, { actor_id: actorId, actor_type: 'staff', category: 'settings',
      action: 'customer_badges.edit', target_type: 'business', target_id: businessId, detail: { badge_count: badges.length } })
  })
  return [...badges].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
}

/** Create-time stamp only. Existing bookings never call this when edited. */
export async function initialPrivateRoomRequirement(businessId: string, customerId?: string | null, menuId?: string | null) {
  const [customer, menu] = await Promise.all([
    customerId ? prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { staffBadges: true } }) : null,
    menuId ? prisma.menu.findFirst({ where: { id: menuId, businessId }, select: { requiredRoomClass: true } }) : null,
  ])
  return !!customer?.staffBadges.includes('個室希望') || menu?.requiredRoomClass === 'private_room'
}
