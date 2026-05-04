import { prisma } from '../db/client.js'

const HOURLY_CAP = Number(process.env.AI_HOURLY_CAP ?? 100)
const DAILY_COST_CAP_CENTS = Number(process.env.AI_DAILY_COST_CAP_CENTS ?? 500)
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export type RateLimitResult = {
  allowed: boolean
  reason: 'ok' | 'hourly_count' | 'daily_cost'
  cap: number
  used: number
  remaining: number
  costCap: number
  costUsed: number
  resetAt: string
}

export async function consumeAiRequest(
  businessId: string,
  route: string,
): Promise<RateLimitResult> {
  const now = Date.now()
  const sinceHour = new Date(now - HOUR_MS)
  const sinceDay = new Date(now - DAY_MS)

  const used = await prisma.aiRequestLog.count({
    where: { businessId, createdAt: { gte: sinceHour }, costCents: null },
  })

  const costAgg = await prisma.aiRequestLog.aggregate({
    where: { businessId, createdAt: { gte: sinceDay } },
    _sum: { costCents: true },
  })
  const costUsed = costAgg._sum.costCents ?? 0

  let allowed = true
  let reason: RateLimitResult['reason'] = 'ok'
  if (used >= HOURLY_CAP) { allowed = false; reason = 'hourly_count' }
  else if (costUsed >= DAILY_COST_CAP_CENTS) { allowed = false; reason = 'daily_cost' }

  if (allowed) {
    await prisma.aiRequestLog.create({ data: { businessId, route } })
  }

  return {
    allowed,
    reason,
    cap: HOURLY_CAP,
    used: allowed ? used + 1 : used,
    remaining: Math.max(0, HOURLY_CAP - (allowed ? used + 1 : used)),
    costCap: DAILY_COST_CAP_CENTS,
    costUsed,
    resetAt: new Date(now + HOUR_MS).toISOString(),
  }
}

/** Record token usage + cost for a successful AI call. */
export async function recordAiUsage(
  businessId: string,
  route: string,
  tokensIn: number | null,
  tokensOut: number | null,
  costCents: number | null,
): Promise<void> {
  await prisma.aiRequestLog.create({
    data: {
      businessId,
      route: `${route}:usage`,
      tokensIn,
      tokensOut,
      costCents,
    },
  })
}
