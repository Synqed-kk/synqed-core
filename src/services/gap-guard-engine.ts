/*
 * gap-guard-engine.ts — スキマガード決定エンジン (W-G1), Phase-1 port.
 * ---------------------------------------------------------------------------
 * FROZEN LOGIC: this is a line-faithful TypeScript port of the frozen
 * gap-guard-engine.js (SPEC-2026-08-12-WG1-GAPGUARD-CORRECTION is the
 * authority; HANDOFF-2026-08-13 defines this Phase). Pure functions only —
 * no DOM, no clock, no randomness, no DB, and — Phase 1 — NO CALLERS: nothing
 * routes into this module yet. gapGuardMode 'OFF' on StoreBookingPolicy is a
 * caller-side gate (the engine is simply not invoked); the engine itself only
 * distinguishes standard/strict.
 *
 * PORT TRAP (cover-message pin #2): the frozen engine treats ANY unrecognized
 * mode value as "standard" (the permissive branch). Callers must normalize
 * the policy enum BEFORE calling create() — never after.
 *
 * Decision axis (2026-08-12 correction): key = [protectedCapacityLoss,
 * otherRepertoireLossCount, deadResidueMin, salvageResidueMin], lexicographic.
 * The first term is NEVER masked by walls/lead-time exemptions.
 */

const LATTICE_STEP_MIN = 5

export interface GapGuardService {
  name: string
  dur: number
}

export interface GapGuardConfig {
  services?: GapGuardService[]
  newClientSessionMin?: number
  protectedDurationMin?: number | null
  protectedLabel?: string
  gapFillMinMin?: number
  blockStepMin?: number
  leadTimeMin?: number
  mode?: 'standard' | 'strict' | string
}

export interface Pocket {
  s: number
  e: number
  walls?: { left?: string | null; right?: string | null }
}

export interface Placement {
  start: number
  dur: number
}

export interface GapGuardCtx {
  now?: number
  protectedWindowFeasible?: (start: number, dur: number) => boolean
  placementFeasible?: (start: number, dur: number) => boolean
}

export interface EvaluateResult {
  verdict?: 'ok' | 'exempt' | 'refuse' | 'degraded'
  reason?: { code: string; params: Record<string, unknown>; ackAllowed?: boolean }
  alternatives: number[]
  alternativeKind: 'safe' | 'least-loss' | null
  leastLossStart?: number
  protectedCapacityBefore: number
  protectedCapacityAfter: number
  protectedCapacityLoss: number
  protectedWindowsBefore: number[]
  protectedWindowsAfter: number[]
}

interface CandidateInfo {
  key: number[]
  protectedCapacityBefore: number
  protectedCapacityAfter: number
  protectedWindowsBefore: number[]
  protectedWindowsAfter: number[]
  lossSet: number[]
  exemptionApplied: boolean
  exemptSide: 'left' | 'right' | null
  wallSide: 'left' | 'right' | null
}

function uniqueSorted(nums: number[]): number[] {
  const seen: Record<number, boolean> = {}
  const out: number[] = []
  nums.forEach((n) => {
    if (typeof n === 'number' && !seen[n]) {
      seen[n] = true
      out.push(n)
    }
  })
  out.sort((a, b) => a - b)
  return out
}

export function create(config: GapGuardConfig = {}) {
  const services = Array.isArray(config.services) ? config.services : []
  const newClientSessionMin = config.newClientSessionMin
  const hasProtectedDuration = Object.prototype.hasOwnProperty.call(config, 'protectedDurationMin')
  const protectedDurationMin = hasProtectedDuration ? config.protectedDurationMin : newClientSessionMin
  const protectedLabel =
    typeof config.protectedLabel === 'string' && config.protectedLabel ? config.protectedLabel : '新規'
  const gapFillMinMin = typeof config.gapFillMinMin === 'number' ? config.gapFillMinMin : 0
  const blockStepMin = config.blockStepMin
  const leadTimeMin = typeof config.leadTimeMin === 'number' ? config.leadTimeMin : 0
  const mode = config.mode === 'strict' ? 'strict' : 'standard'

  const _serviceDurationSet = uniqueSorted(services.map((s) => s.dur))
  const _durationSet = uniqueSorted(
    _serviceDurationSet.concat(typeof protectedDurationMin === 'number' ? [protectedDurationMin] : []),
  )
  const _otherDurationSet = _serviceDurationSet.filter((d) => d !== protectedDurationMin)

  function durationSet(): number[] {
    return _durationSet.slice()
  }

  function fillableExactly(min: number): boolean {
    if (min === 0) return true
    if (min < 0 || min % LATTICE_STEP_MIN !== 0 || _durationSet.length === 0) return false
    const steps = min / LATTICE_STEP_MIN
    const coins = _durationSet.map((d) => d / LATTICE_STEP_MIN)
    const dp: boolean[] = new Array(steps + 1)
    dp[0] = true
    for (let i = 1; i <= steps; i++) {
      dp[i] = false
      for (let c = 0; c < coins.length; c++) {
        if (coins[c] <= i && dp[i - coins[c]]) {
          dp[i] = true
          break
        }
      }
    }
    return dp[steps]
  }

  function fillDecomposition(min: number): number[] | null {
    if (min === 0) return []
    if (min < 0 || min % LATTICE_STEP_MIN !== 0 || _durationSet.length === 0) return null
    const desc = _durationSet.slice().sort((a, b) => b - a)
    let remaining = min
    const picks: number[] = []
    while (remaining > 0) {
      let found = false
      for (let i = 0; i < desc.length; i++) {
        if (desc[i] <= remaining) {
          picks.push(desc[i])
          remaining -= desc[i]
          found = true
          break
        }
      }
      if (!found) return null
    }
    return picks
  }

  function hostableFrom(set: number[], len: number): number[] {
    return set.filter((d) => d <= len)
  }

  function hostable(len: number): number[] {
    return hostableFrom(_durationSet, len)
  }

  function residueClass(len: number, exempt: boolean): { dead: number; salvage: number } {
    if (len <= 0 || exempt) return { dead: 0, salvage: 0 }
    if (fillableExactly(len)) return { dead: 0, salvage: 0 }
    if (gapFillMinMin > 0 && len >= gapFillMinMin) return { dead: 0, salvage: len }
    return { dead: len, salvage: 0 }
  }

  function repertoireLossSet(pocketLen: number, maskedLenL: number, maskedLenR: number): number[] {
    if (maskedLenL <= 0 && maskedLenR <= 0) return []
    const base = hostableFrom(_otherDurationSet, pocketLen)
    const union: Record<number, boolean> = {}
    hostableFrom(_otherDurationSet, maskedLenL).forEach((d) => {
      union[d] = true
    })
    hostableFrom(_otherDurationSet, maskedLenR).forEach((d) => {
      union[d] = true
    })
    return base.filter((d) => !union[d])
  }

  function spansOverlap(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
    return aStart < bStart + bDur && bStart < aStart + aDur
  }

  function protectedWindows(pocket: Pocket, placement: Placement | null, ctx?: GapGuardCtx): number[] {
    if (typeof protectedDurationMin !== 'number' || protectedDurationMin <= 0) return []
    const feasible =
      ctx && typeof ctx.protectedWindowFeasible === 'function' ? ctx.protectedWindowFeasible : null
    const firstStart = feasible ? Math.ceil(pocket.s / LATTICE_STEP_MIN) * LATTICE_STEP_MIN : pocket.s
    const selected: number[] = []
    let lastEnd = -Infinity
    for (let s = firstStart; s + protectedDurationMin <= pocket.e; s += LATTICE_STEP_MIN) {
      if (placement && spansOverlap(s, protectedDurationMin, placement.start, placement.dur)) continue
      if (feasible && !feasible(s, protectedDurationMin)) continue
      if (s < lastEnd) continue
      selected.push(s)
      lastEnd = s + protectedDurationMin
    }
    return selected
  }

  function protectedCapacity(pocket: Pocket, placement: Placement | null, ctx?: GapGuardCtx) {
    const beforeWindows = protectedWindows(pocket, null, ctx)
    const afterWindows = placement ? protectedWindows(pocket, placement, ctx) : beforeWindows.slice()
    return {
      before: beforeWindows.length,
      after: afterWindows.length,
      loss: Math.max(0, beforeWindows.length - afterWindows.length),
      beforeStarts: beforeWindows,
      afterStarts: afterWindows,
    }
  }

  function wallExempt(side: 'left' | 'right', len: number, pocket: Pocket): boolean {
    return len > 0 && Boolean(pocket.walls && pocket.walls[side])
  }

  function leadTimeExempt(len: number, residueEnd: number, ctx?: GapGuardCtx): boolean {
    if (len <= 0 || !ctx || typeof ctx.now !== 'number') return false
    return residueEnd <= ctx.now + leadTimeMin
  }

  function candidateKey(
    pocket: Pocket,
    start: number,
    dur: number,
    ctx: GapGuardCtx | undefined,
    protectedBefore?: number[],
  ): CandidateInfo {
    const placement = { start, dur }
    const beforeWindows = protectedBefore || protectedWindows(pocket, null, ctx)
    const afterWindows = protectedWindows(pocket, placement, ctx)
    const protectedLoss = Math.max(0, beforeWindows.length - afterWindows.length)
    const lenL = start - pocket.s
    const lenR = pocket.e - (start + dur)
    const exemptL = wallExempt('left', lenL, pocket) || leadTimeExempt(lenL, start, ctx)
    const exemptR = wallExempt('right', lenR, pocket) || leadTimeExempt(lenR, pocket.e, ctx)
    const clsL = residueClass(lenL, exemptL)
    const clsR = residueClass(lenR, exemptR)
    const lossSet = repertoireLossSet(pocket.e - pocket.s, exemptL ? 0 : lenL, exemptR ? 0 : lenR)
    return {
      key: [protectedLoss, lossSet.length, clsL.dead + clsR.dead, clsL.salvage + clsR.salvage],
      protectedCapacityBefore: beforeWindows.length,
      protectedCapacityAfter: afterWindows.length,
      protectedWindowsBefore: beforeWindows.slice(),
      protectedWindowsAfter: afterWindows,
      lossSet,
      exemptionApplied: (exemptL && lenL > 0) || (exemptR && lenR > 0),
      exemptSide: exemptL ? 'left' : exemptR ? 'right' : null,
      wallSide: wallExempt('left', lenL, pocket) ? 'left' : wallExempt('right', lenR, pocket) ? 'right' : null,
    }
  }

  function compareKeys(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === undefined || b[i] === undefined) return a.length - b.length
      if (a[i] !== b[i]) return a[i] - b[i]
    }
    return 0
  }

  function placementIsFeasible(start: number, dur: number, ctx?: GapGuardCtx): boolean {
    const feasible = ctx && typeof ctx.placementFeasible === 'function' ? ctx.placementFeasible : null
    return feasible ? Boolean(feasible(start, dur)) : true
  }

  function candidateStarts(pocket: Pocket, dur: number, ctx?: GapGuardCtx): number[] {
    const hasFeasibilityCallback = ctx && typeof ctx.placementFeasible === 'function'
    const firstStart = hasFeasibilityCallback
      ? Math.ceil(pocket.s / LATTICE_STEP_MIN) * LATTICE_STEP_MIN
      : pocket.s
    const starts: number[] = []
    for (let s = firstStart; s + dur <= pocket.e; s += LATTICE_STEP_MIN) {
      if (placementIsFeasible(s, dur, ctx)) starts.push(s)
    }
    return starts
  }

  function isZeroKey(key: number[]): boolean {
    return key.every((n) => n === 0)
  }

  function safeStarts(pocket: Pocket, dur: number, ctx?: GapGuardCtx): number[] {
    const protectedBefore = protectedWindows(pocket, null, ctx)
    return candidateStarts(pocket, dur, ctx).filter((start) =>
      isZeroKey(candidateKey(pocket, start, dur, ctx, protectedBefore).key),
    )
  }

  function nearestBestAlternatives(
    candidateInfos: Array<{ start: number; info: CandidateInfo }>,
    attemptedStart: number,
    attemptedKey: number[],
    bestKey: number[] | null,
    requireStrictlyBetter: boolean,
  ): { starts: number[]; kind: 'safe' | 'least-loss' | null } {
    if (!bestKey || (requireStrictlyBetter && compareKeys(bestKey, attemptedKey) >= 0)) {
      return { starts: [], kind: null }
    }
    const bestStarts = candidateInfos
      .filter((candidate) => compareKeys(candidate.info.key, bestKey) === 0)
      .map((candidate) => candidate.start)
    let before: number | null = null
    let after: number | null = null
    bestStarts.forEach((s) => {
      if (s < attemptedStart && (before === null || s > before)) before = s
      if (s > attemptedStart && (after === null || s < after)) after = s
    })
    const out: number[] = []
    if (before !== null) out.push(before)
    if (after !== null) out.push(after)
    return {
      starts: out,
      kind: out.length ? (isZeroKey(bestKey) ? 'safe' : 'least-loss') : null,
    }
  }

  function repLabel(lossSet: number[]): string {
    const sorted = lossSet.slice().sort((a, b) => b - a)
    const maxLost = sorted[0]
    const svc = services.filter((s) => s.dur === maxLost)[0]
    return svc ? svc.name : `${maxLost}分`
  }

  function reasonForKey(key: number[], lossSet: number[], info: CandidateInfo) {
    if (key[0] > 0)
      return {
        code: 'R-REP',
        params: {
          label: `${protectedLabel}（${protectedDurationMin}分）`,
          capacityBefore: info.protectedCapacityBefore,
          capacityAfter: info.protectedCapacityAfter,
          capacityLost: key[0],
        },
      }
    if (key[1] > 0) return { code: 'R-REP', params: { label: repLabel(lossSet) } }
    if (key[2] > 0) return { code: 'R-DEAD', params: { n: key[2] } }
    return { code: 'R-SALV', params: { n: key[3] } }
  }

  function evaluate(pocket: Pocket, placement: Placement, ctx?: GapGuardCtx): EvaluateResult {
    ctx = ctx || {}
    const start = placement.start
    const dur = placement.dur
    const protectedBefore = protectedWindows(pocket, null, ctx)
    const attempted = candidateKey(pocket, start, dur, ctx, protectedBefore)
    const attemptedFeasible =
      start >= pocket.s && start + dur <= pocket.e && placementIsFeasible(start, dur, ctx)
    const starts = candidateStarts(pocket, dur, ctx)
    const candidateInfos: Array<{ start: number; info: CandidateInfo }> = []
    let best: number[] | null = null
    starts.forEach((s) => {
      const info = s === start ? attempted : candidateKey(pocket, s, dur, ctx, protectedBefore)
      candidateInfos.push({ start: s, info })
      if (best === null || compareKeys(info.key, best) < 0) best = info.key
    })

    const result: EvaluateResult = {
      alternatives: [],
      alternativeKind: null,
      protectedCapacityBefore: attempted.protectedCapacityBefore,
      protectedCapacityAfter: attempted.protectedCapacityAfter,
      protectedCapacityLoss: attempted.key[0],
      protectedWindowsBefore: attempted.protectedWindowsBefore.slice(),
      protectedWindowsAfter: attempted.protectedWindowsAfter.slice(),
    }

    if (!attemptedFeasible) {
      result.verdict = 'refuse'
      result.reason = { code: 'R-UNAVAILABLE', params: { start, dur }, ackAllowed: false }
      const unavailableChoices = nearestBestAlternatives(candidateInfos, start, attempted.key, best, false)
      result.alternatives = unavailableChoices.starts
      result.alternativeKind = unavailableChoices.kind
      return result
    }

    if (isZeroKey(attempted.key)) {
      if (attempted.exemptionApplied) {
        result.verdict = 'exempt'
        result.reason = {
          code: 'EXEMPT',
          params: {
            trigger: attempted.wallSide ? 'wall' : 'leadTime',
            wallType: attempted.wallSide ? pocket.walls?.[attempted.wallSide] ?? null : null,
          },
        }
      } else {
        result.verdict = 'ok'
      }
      return result
    }

    const somethingStrictlyBetter = best !== null && compareKeys(best, attempted.key) < 0
    if (somethingStrictlyBetter) {
      result.verdict = 'refuse'
      const reason = reasonForKey(attempted.key, attempted.lossSet, attempted) as EvaluateResult['reason']
      reason!.ackAllowed = mode === 'standard' // #7 裁定: 標準/厳格の唯一の分岐点
      result.reason = reason
      const rankedChoices = nearestBestAlternatives(candidateInfos, start, attempted.key, best, true)
      result.alternatives = rankedChoices.starts
      result.alternativeKind = rankedChoices.kind
    } else {
      result.verdict = 'degraded'
      let leastStart = start
      for (let i = 0; i < candidateInfos.length; i++) {
        if (compareKeys(candidateInfos[i].info.key, attempted.key) === 0) {
          leastStart = candidateInfos[i].start
          break
        }
      }
      result.leastLossStart = leastStart
      const underlying = reasonForKey(attempted.key, attempted.lossSet, attempted)
      result.reason = { code: 'DEGRADED', params: Object.assign({ t: leastStart }, underlying.params) }
    }
    return result
  }

  return {
    durationSet,
    fillableExactly,
    fillDecomposition,
    hostable,
    protectedCapacity,
    safeStarts,
    evaluate,
    config: {
      services,
      newClientSessionMin,
      protectedDurationMin,
      protectedLabel,
      gapFillMinMin,
      blockStepMin,
      leadTimeMin,
      mode,
    },
  }
}

export const GapGuard = { create }
