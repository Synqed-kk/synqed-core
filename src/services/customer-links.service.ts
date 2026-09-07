import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client.js'
import { logEventIn } from './audit.service.js'

export class CustomerLinkError extends Error {}

// Shared with burns: a link removal must not race a stale authorization read.
export async function lockPackSharing(tx: Prisma.TransactionClient, businessId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pack-sharing:${businessId}`}, 0))`
}

export async function linkedCustomerIds(tx: Prisma.TransactionClient, businessId: string, customerId: string) {
  const customer = await tx.customer.findFirst({ where: { id: customerId, businessId, deletedAt: null }, select: { id: true, packSharingGroupId: true } })
  if (!customer) return []
  if (!customer.packSharingGroupId) return [customer.id]
  const rows = await tx.customer.findMany({ where: { businessId, deletedAt: null, packSharingGroupId: customer.packSharingGroupId }, select: { id: true }, orderBy: { id: 'asc' } })
  return rows.map(row => row.id)
}

export async function getCustomerLinks(businessId: string, customerId: string) {
  return prisma.$transaction(async tx => ({ customer_ids: await linkedCustomerIds(tx, businessId, customerId) }), { isolationLevel: 'RepeatableRead' })
}

/** Replace one family's full member set. Include the anchor; one member means
 * unlink. Other families must first be explicitly unlinked, never merged as
 * an accidental side effect of adding a person. */
export async function setCustomerLinks(businessId: string, anchor: string, ids: string[], actorId: string) {
  return prisma.$transaction(async tx => {
    await lockPackSharing(tx, businessId)
    if (!ids.includes(anchor)) throw new CustomerLinkError('Include the anchor customer in customer_ids')
    const anchorRow = await tx.customer.findFirst({ where: { id: anchor, businessId, deletedAt: null } })
    if (!anchorRow) throw new CustomerLinkError('Customer not found in this business')
    const members = await tx.customer.findMany({ where: { id: { in: ids }, businessId, deletedAt: null } })
    if (members.length !== ids.length) throw new CustomerLinkError('All members must be active customers in this business')
    if (members.some(row => row.packSharingGroupId && row.packSharingGroupId !== anchorRow.packSharingGroupId)) {
      throw new CustomerLinkError('Unlink members from their existing family first')
    }
    const before = await linkedCustomerIds(tx, businessId, anchor)
    if (anchorRow.packSharingGroupId) await tx.customer.updateMany({ where: { businessId, packSharingGroupId: anchorRow.packSharingGroupId }, data: { packSharingGroupId: null } })
    const groupId = ids.length > 1 ? anchorRow.packSharingGroupId ?? randomUUID() : null
    await tx.customer.updateMany({ where: { id: { in: ids }, businessId }, data: { packSharingGroupId: groupId } })
    await logEventIn(tx, businessId, { actor_id: actorId, actor_type: 'staff', category: 'customer', action: 'customer.pack_sharing', target_type: 'customer', target_id: anchor,
      detail: { before, after: [...ids].sort() } })
    return { customer_ids: [...ids].sort() }
  })
}

/** Erased customers retain accounting UUIDs in the ledger, but new audit
 * events must not reconstruct an already-scrubbed family relationship. */
export async function sharingAuditDetail(tx: Prisma.TransactionClient, businessId: string, packId: string, holderId: string, visitorId: string) {
  const rows = await tx.customer.findMany({ where: { businessId, id: { in: [holderId, visitorId] } }, select: { id: true } })
  const live = new Set(rows.map(row => row.id))
  const reference = (id: string) => live.has(id) ? id : createHash('sha256').update(id).digest('hex')
  return { pack_id: packId, pack_holder_customer_id: reference(holderId), visitor_customer_id: reference(visitorId) }
}
