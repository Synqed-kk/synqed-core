import { prisma } from '../db/client.js'

// Global AI-response cache. Not tenant-scoped (the key is a hash of the input).

/** Read a cache entry — null if absent OR expired (callers recompute on miss). */
export async function getCache(key: string): Promise<unknown | null> {
  const row = await prisma.aiCache.findUnique({ where: { cacheKey: key } })
  if (!row) return null
  if (row.expiresAt.getTime() <= Date.now()) return null
  return row.result
}

export async function upsertCache(
  key: string,
  result: unknown,
  expiresAt: string,
): Promise<{ ok: true }> {
  await prisma.aiCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, result: result as object, expiresAt: new Date(expiresAt) },
    update: { result: result as object, expiresAt: new Date(expiresAt) },
  })
  return { ok: true }
}

/** Cross-business maintenance: delete all expired entries. */
export async function cleanupExpired(): Promise<{ deleted: number }> {
  const res = await prisma.aiCache.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return { deleted: res.count }
}
