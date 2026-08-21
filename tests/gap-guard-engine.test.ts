// Regression tests for the frozen スキマガード decision engine (Phase-1 port).
// Config = the frozen fixture world (fixtures-business-v1.js, cover pin #1):
// services 45/60/75 · gapFillMinMin 30 · leadTimeMin 60 · newClientSessionMin
// 90. Expected values reproduce ONLY under these numbers — a different menu
// set flips verdicts, which is why the fixture ships. Pure unit tests — no DB.
import { describe, it, expect } from 'vitest'
import { GapGuard } from '../src/services/gap-guard-engine.js'

const FIXTURE_SERVICES = [
  { name: 'カット', dur: 45 },
  { name: 'カット+カラー', dur: 60 },
  { name: 'フルコース', dur: 75 },
]

function engine(over: Record<string, unknown> = {}) {
  return GapGuard.create({
    services: FIXTURE_SERVICES,
    newClientSessionMin: 90,
    gapFillMinMin: 30,
    leadTimeMin: 60,
    mode: 'standard',
    ...over,
  })
}

describe('gap-guard engine — frozen regression set', () => {
  it('150-minute pocket: 60 at either edge keeps the 90-window alive (ok); centre kills it (refuse, ack allowed in standard only)', async () => {
    const pocket = { s: 0, e: 150 }
    const g = engine()

    // Edge placements: one 90-minute protected window survives → zero key.
    expect(g.evaluate(pocket, { start: 0, dur: 60 }).verdict).toBe('ok')
    expect(g.evaluate(pocket, { start: 90, dur: 60 }).verdict).toBe('ok')

    // Centre placement (45+45 leftovers): the protected window dies.
    const centre = g.evaluate(pocket, { start: 45, dur: 60 })
    expect(centre.verdict).toBe('refuse')
    expect(centre.protectedCapacityBefore).toBe(1)
    expect(centre.protectedCapacityAfter).toBe(0)
    expect(centre.protectedCapacityLoss).toBe(1)
    expect(centre.reason?.code).toBe('R-REP')
    expect(centre.reason?.ackAllowed).toBe(true) // standard: acknowledge-and-place exists

    // strict never permits acknowledge-and-place — the ONLY mode divergence.
    const strictCentre = engine({ mode: 'strict' }).evaluate(pocket, { start: 45, dur: 60 })
    expect(strictCentre.verdict).toBe('refuse')
    expect(strictCentre.reason?.ackAllowed).toBe(false)

    // PORT TRAP pin: an unrecognized mode falls into the PERMISSIVE branch —
    // normalization must happen before the engine, never after.
    const weird = GapGuard.create({ services: FIXTURE_SERVICES, newClientSessionMin: 90, mode: 'OFF' })
    expect(weird.config.mode).toBe('standard')
  })

  it('45+45 protected-capacity-loss attack: alternatives point at the edges (safe kind)', () => {
    const g = engine()
    const res = g.evaluate({ s: 0, e: 150 }, { start: 45, dur: 60 })
    expect(res.alternatives).toEqual([0, 90]) // the edges — the only zero-key starts
    expect(res.alternativeKind).toBe('safe')
    // and the pocket's full safe-start set includes the true edges
    const safe = g.safeStarts({ s: 0, e: 150 }, 60)
    expect(safe).toContain(0)
    expect(safe).toContain(90)
    expect(safe).not.toContain(45)
  })

  it('placement + protected-window feasibility callbacks together — absolute five-minute probing (pathological half-on combos by design)', () => {
    const g = engine()
    // Pocket starts OFF-lattice at 7; with callbacks, probing snaps to the
    // absolute 5-minute clock (10, 15, ...), never 7.
    const probed: number[] = []
    const placementProbed: number[] = []
    const res = g.evaluate(
      { s: 7, e: 157 },
      { start: 10, dur: 60 },
      {
        protectedWindowFeasible: (s: number) => {
          probed.push(s)
          return s % 10 === 0 // half-on: only even-decade starts publishable
        },
        placementFeasible: (s: number) => {
          placementProbed.push(s)
          return s % 10 === 0
        },
      },
    )
    expect(probed.every((s) => s % 5 === 0)).toBe(true) // absolute lattice
    expect(placementProbed.every((s) => s % 5 === 0)).toBe(true)
    expect(probed).not.toContain(7)
    expect(res.verdict).toBeDefined()

    // attempt itself infeasible → R-UNAVAILABLE regardless of ranking
    const blocked = g.evaluate(
      { s: 0, e: 150 },
      { start: 5, dur: 60 },
      { placementFeasible: (s: number) => s % 10 === 0 },
    )
    expect(blocked.verdict).toBe('refuse')
    expect(blocked.reason?.code).toBe('R-UNAVAILABLE')
    expect(blocked.reason?.ackAllowed).toBe(false)
  })

  it('protected-capacity-first ranking: a placement losing the 90-window loses to one shedding only repertoire/residue', () => {
    const g = engine()
    // 105-minute pocket, place 60: any placement kills the single 90-window
    // (105 - 60 = 45 < 90 on either side) → nothing strictly better exists on
    // the first axis → degraded (loss unavoidable), never refuse.
    const res = g.evaluate({ s: 0, e: 105 }, { start: 0, dur: 60 })
    expect(res.protectedCapacityBefore).toBe(1)
    expect(res.protectedCapacityAfter).toBe(0)
    expect(res.verdict).toBe('degraded')
    expect(res.reason?.code).toBe('DEGRADED')
    expect(typeof res.leastLossStart).toBe('number')
  })

  it('safe versus least-loss alternatives: when no zero-key start exists, choices carry least-loss kind', () => {
    const g = engine()
    // Same 105 pocket, but attempt an infeasible start so choices come from
    // the feasible best pool without the strictly-better requirement.
    const res = g.evaluate(
      { s: 0, e: 105 },
      { start: 200, dur: 60 },
      { placementFeasible: () => true },
    )
    expect(res.verdict).toBe('refuse')
    expect(res.reason?.code).toBe('R-UNAVAILABLE')
    expect(res.alternatives.length).toBeGreaterThan(0)
    expect(res.alternativeKind).toBe('least-loss') // pocket best is non-zero here
  })

  it('zero-capacity result data: pocket smaller than the protected duration reports all-zero capacity and empty window arrays', () => {
    const g = engine()
    // 60-minute pocket: no 90-window fits at all — before/after/loss all 0.
    const res = g.evaluate({ s: 0, e: 60 }, { start: 0, dur: 60 })
    expect(res.protectedCapacityBefore).toBe(0)
    expect(res.protectedCapacityAfter).toBe(0)
    expect(res.protectedCapacityLoss).toBe(0)
    expect(res.protectedWindowsBefore).toEqual([])
    expect(res.protectedWindowsAfter).toEqual([])
    expect(res.verdict).toBe('ok') // exact fill: zero residue, zero loss
  })

  it('duration mechanics under the fixture set: durationSet, exact fill, greedy decomposition trap, hostable', () => {
    const g = engine()
    expect(g.durationSet()).toEqual([45, 60, 75, 90])
    expect(g.fillableExactly(105)).toBe(true) // 45+60
    expect(g.fillableExactly(35)).toBe(false)
    // greedy takes 90 first and strands 15 — fillable but decomposition null
    expect(g.fillDecomposition(105)).toBeNull()
    expect(g.fillDecomposition(90)).toEqual([90])
    expect(g.hostable(50)).toEqual([45])
  })

  it('wall and lead-time exemptions never mask the protected-capacity term', () => {
    const g = engine()
    // Walls on both sides of the 150 pocket: centre placement still refuses —
    // the first axis is absolute.
    const res = g.evaluate(
      { s: 0, e: 150, walls: { left: 'closed', right: 'closed' } },
      { start: 45, dur: 60 },
    )
    expect(res.verdict).toBe('refuse')
    expect(res.protectedCapacityLoss).toBe(1)

    // But a wall-side residue with zero protected loss IS exempt: 105 pocket
    // has no surviving window either way (loss 0 candidates exist? here
    // before=1 so loss axis fires — use a 90 pocket: window exactly fits, any
    // 60 placement kills it → not exempt. Use a 75 pocket: no window fits,
    // 60 placement leaves 15 dead → wall exemption turns it clean.
    const wallRes = g.evaluate(
      { s: 0, e: 75, walls: { right: 'closing' } },
      { start: 0, dur: 60 },
    )
    expect(wallRes.verdict).toBe('exempt')
    expect(wallRes.reason?.code).toBe('EXEMPT')
    expect(wallRes.reason?.params.trigger).toBe('wall')
  })
})
