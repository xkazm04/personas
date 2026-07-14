// The sensor scoreboard's numbers (docs/plans/dev-findings-loop.md §7, Phase 3B).
//
// The Agent Scoreboard scores the 21 scan agents on ideas ACCEPTED and tasks
// COMPLETED — i.e. on whether a human said yes and a PR merged. That was the best
// signal available, but it rewards *plausibility*, not *effect*: an agent whose
// ideas always merge and never change anything scores perfectly.
//
// A sensor can be scored on something better, because a sensor measures a NUMBER
// and we re-measure it after the work ships. So the headline metric here is the
// VERIFY RATE — of the findings that actually shipped and got judged, how many
// moved the number? That is credit for reality moving, not for looking convincing.
//
// A low verify rate is itself the product (B2): a sensor whose findings ship and
// change nothing is emitting noise, and you want to see that.
import type { DevIdea } from '@/lib/bindings/DevIdea';

export interface SensorStats {
  origin: string;
  /** Findings raised by this sensor (any status). */
  raised: number;
  accepted: number;
  rejected: number;
  pending: number;
  /** Findings that shipped AND got a verdict — the denominator that matters. */
  verdicted: number;
  cleared: number;
  moved: number;
  unchanged: number;
  regressed: number;
  /** (cleared + moved) / verdicted — "when this sensor's work ships, does the
   *  number actually move?". `null` until something has been judged: an unproven
   *  sensor must not be shown as 0% (that reads as "bad", not "unknown"). */
  verifyRate: number | null;
  /** True once the sensor has enough judged findings to be worth believing. */
  hasEnoughSignal: boolean;
}

/** Below this many verdicts, a verify rate is noise — label it, don't rank on it. */
export const MIN_VERDICTS_FOR_CREDIBILITY = 3;

export function computeSensorStats(ideas: DevIdea[]): SensorStats[] {
  const byOrigin = new Map<string, DevIdea[]>();
  for (const i of ideas) {
    if (!i.origin) continue; // classic scanner ideas belong to the Agent Scoreboard
    const list = byOrigin.get(i.origin) ?? [];
    list.push(i);
    byOrigin.set(i.origin, list);
  }

  const out: SensorStats[] = [];
  for (const [origin, list] of byOrigin) {
    const count = (pred: (i: DevIdea) => boolean) => list.filter(pred).length;
    const verdict = (s: string) => count((i) => i.verify_state === s);

    const cleared = verdict('cleared');
    const moved = verdict('moved');
    const unchanged = verdict('unchanged');
    const regressed = verdict('regressed');
    const verdicted = cleared + moved + unchanged + regressed;

    out.push({
      origin,
      raised: list.length,
      accepted: count((i) => i.status === 'accepted'),
      rejected: count((i) => i.status === 'rejected'),
      pending: count((i) => i.status === 'pending'),
      verdicted,
      cleared,
      moved,
      unchanged,
      regressed,
      verifyRate: verdicted === 0 ? null : (cleared + moved) / verdicted,
      hasEnoughSignal: verdicted >= MIN_VERDICTS_FOR_CREDIBILITY,
    });
  }

  // Worst-performing credible sensor first — that's the one worth acting on
  // (either its threshold is wrong, or it's pointing at work that doesn't pay).
  return out.sort((a, b) => {
    if (a.hasEnoughSignal !== b.hasEnoughSignal) return a.hasEnoughSignal ? -1 : 1;
    if (a.verifyRate === null || b.verifyRate === null) return b.raised - a.raised;
    return a.verifyRate - b.verifyRate;
  });
}

/**
 * B2 — the credibility read. A sensor with enough judged findings and a poor verify
 * rate is emitting noise: its work ships and the number doesn't move. Advisory only
 * (we do NOT auto-retune thresholds — a sensor that silently changes its own mind is
 * hard to trust before we've seen real rates).
 */
export const NOISY_SENSOR_THRESHOLD = 0.34;

export function isNoisySensor(s: SensorStats): boolean {
  return s.hasEnoughSignal && s.verifyRate !== null && s.verifyRate < NOISY_SENSOR_THRESHOLD;
}
