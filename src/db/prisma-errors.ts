// True when `e` is a Prisma P2002 unique-constraint violation whose target
// includes `field`. meta.target is either an array of field names or the
// constraint-name string, so we match against the stringified form. Shared by
// every write that needs to react to a specific unique key (customer create,
// the QR sync ladder) — one definition, no copies.
export function isUniqueViolation(e: unknown, field: string): boolean {
  if (e === null || typeof e !== 'object' || !('code' in e)) return false
  if ((e as { code?: unknown }).code !== 'P2002') return false
  const target = (e as { meta?: { target?: unknown } }).meta?.target
  const asStr = Array.isArray(target) ? target.join(',') : String(target ?? '')
  return asStr.includes(field)
}
