import { prisma } from '../db/client.js'

const migration = '2026-09-08-core-5-customer-merges'

/** Only the operator migration writes this marker; customer API inputs cannot. */
export function mergedCustomerTarget(externalRefs: unknown): string | null {
  if (!externalRefs || typeof externalRefs !== 'object' || !('core5_merge' in externalRefs)) return null
  const marker = externalRefs.core5_merge
  if (!marker || typeof marker !== 'object' || !('migration' in marker) || marker.migration !== migration
    || !('keep_customer_id' in marker) || typeof marker.keep_customer_id !== 'string') {
    throw new Error('Invalid customer merge marker')
  }
  return marker.keep_customer_id
}

/** Resolve retained import identities without granting ownership of any record. */
export async function resolveMergedCustomer(businessId: string, id: string) {
  const row = await prisma.customer.findFirst({ where: { id, businessId } })
  if (!row) throw new Error('Customer not found')
  const target = mergedCustomerTarget(row.externalRefs)
  if (!target) return row
  const keep = await prisma.customer.findFirst({ where: { id: target, businessId, deletedAt: null } })
  if (!row.deletedAt || !keep || mergedCustomerTarget(keep.externalRefs)) throw new Error('Invalid customer merge target')
  return keep
}
