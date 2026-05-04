import { prisma } from '../db/client.js'

const HOURLY_CAP = Number(process.env.AI_HOURLY_CAP ?? 100)
const WINDOW_MS = 60 * 60 * 1000

export type RateLimitResult = {
  allowed: boolean
  cap: number
  used: number
  remaining: number
  resetAt: string
}

export async function consumeAiRequest(
  businessId: string,
  route: string,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MS)
  const used = await prisma.aiRequestLog.count({
    where: { businessId, createdAt: { gte: since } },
  })
  const allowed = used < HOURLY_CAP
  if (allowed) {
    await prisma.aiRequestLog.create({ data: { businessId, route } })
  }
  return {
    allowed,
    cap: HOURLY_CAP,
    used: allowed ? used + 1 : used,
    remaining: Math.max(0, HOURLY_CAP - (allowed ? used + 1 : used)),
    resetAt: new Date(Date.now() + WINDOW_MS).toISOString(),
  }
}
