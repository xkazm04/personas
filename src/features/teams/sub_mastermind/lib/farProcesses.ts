// What is actually WORKING on a project right now, reduced to the buckets the
// far-zoom island paints on its hex border. Pure — no React, no store.
//
// The far band answers one question and no others: "is anything happening
// here?". Readiness, wiring and KPIs are all mid/near/close concerns (and the
// island's halo still carries readiness colour underneath), so the only inputs
// here are the live work LANES the canvas tracks: Fleet CLI sessions, personas
// with an execution in progress, and dev-runner tasks (engine work with no
// terminal and no persona attached).
//
// Mid renders the same three lanes broken apart, so both bands MUST reduce from
// this one module — a mid breakdown that did not add up to the far count would
// make one of the two bands a liar, and the operator zooms between them.
import { FLEET_STATE_ORDER } from './fleetMeta';
import { FLEET_INK } from './ink';
import type { FleetNode, RunnerNode } from './types';

/** Persona lane ink — the same token FleetBadges paints its persona pill with,
 *  so the two surfaces agree on what "a persona is working" looks like. */
export const PERSONA_INK = 'var(--status-processing)';

/** Dev-runner lane ink. Distinct from the persona lane on purpose: both are
 *  headless, and if they shared a colour the mid breakdown would show two bars
 *  the operator could not tell apart. */
export const RUNNER_INK = 'var(--accent)';

/** The three lanes, in the order every surface renders them. */
export type LaneKey = 'fleet' | 'persona' | 'runner';

/** A session that has EXITED is not development running behind a project. The
 *  page already strips exited sessions for real projects; demo islands carry
 *  their own fixture fleet, so the filter lives here too rather than relying on
 *  the caller — "3 running" must never be counting something that finished. */
const DEAD_STATES = new Set(['exited']);

/** True when a session still counts as live work. Exported for surfaces that
 *  render per-SESSION marks (the mid Tally pips) — they must show exactly the
 *  set this module counts, or the pips would not sum to the numbers. */
export const isLiveSession = (f: FleetNode): boolean => !DEAD_STATES.has(f.state);

export interface ProcessBucket {
  /** Fleet state token, or the literal `personas` / `runners` lane key. */
  key: string;
  kind: LaneKey;
  count: number;
  /** Theme-token colour for this bucket's border arc. */
  ink: string;
}

/**
 * Live processes behind one island, grouped for the far band's border encoding.
 *
 * Ordered attention-worthy-first (FLEET_STATE_ORDER: awaiting_input, running,
 * spawning, …) with the headless lanes last, so the first arc drawn — and the
 * colour the hex body is tinted with — is always the one the operator most
 * needs to see. Fleet states outside the known order are kept rather than
 * dropped: an unrecognised state is still a running thing, and silently
 * omitting it would make the number lie.
 */
export function processBuckets(
  fleet: readonly FleetNode[],
  personas: readonly string[],
  runners: readonly RunnerNode[] = [],
): ProcessBucket[] {
  const counts = new Map<string, number>();
  for (const f of fleet) {
    if (DEAD_STATES.has(f.state)) continue;
    counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
  }
  const known = FLEET_STATE_ORDER as readonly string[];
  const ordered = [
    ...known.filter((s) => counts.has(s)),
    ...[...counts.keys()].filter((s) => !known.includes(s)).sort(),
  ];
  const buckets: ProcessBucket[] = ordered.map((state) => ({
    key: state,
    kind: 'fleet' as const,
    count: counts.get(state)!,
    ink: FLEET_INK[state] ?? 'var(--status-neutral)',
  }));
  if (personas.length > 0) {
    buckets.push({ key: 'personas', kind: 'persona', count: personas.length, ink: PERSONA_INK });
  }
  if (runners.length > 0) {
    buckets.push({ key: 'runners', kind: 'runner', count: runners.length, ink: RUNNER_INK });
  }
  return buckets;
}

/** Total live processes — the number the far-zoom hex fills itself with. */
export function processTotal(buckets: readonly ProcessBucket[]): number {
  let n = 0;
  for (const b of buckets) n += b.count;
  return n;
}

// ── Lane rollup (the MID band's model) ───────────────────────────────────────
//
// Far asks "how much?"; mid asks "of what?". Same processes, one level of
// structure up: three lanes, each with its own count, its own dominant state,
// and its own attention flag. Both bands reduce from `processBuckets`, so the
// three lane counts always sum to the number far renders.

/** How urgent a lane's state is — decides which state a lane reports when it
 *  holds several. Lower is more urgent. Unlisted states sort last. */
const STATE_URGENCY: Record<string, number> = {
  awaiting_input: 0,
  stale: 1,
  running: 2,
  spawning: 3,
  queued: 4,
  idle: 5,
  hibernated: 6,
};

export interface ProcessLane {
  key: LaneKey;
  count: number;
  ink: string;
  /**
   * The most urgent state present in this lane, or null when the lane has no
   * per-item state worth naming (personas are simply "in progress").
   */
  state: string | null;
  /** This lane holds something that has stopped and is waiting on a human. */
  attention: boolean;
}

/** True when a lane's state means "this has stopped and needs a person". */
export const needsOperator = (state: string): boolean =>
  state === 'awaiting_input' || state === 'stale';

/**
 * The three lanes, always all three and always in the same order — an empty
 * lane is rendered as an empty lane, not omitted. A missing lane and a
 * zero-count lane look identical once they are gone, and "no runner is working
 * on this" is a fact the operator wants to be able to read directly.
 */
export function processLanes(
  fleet: readonly FleetNode[],
  personas: readonly string[],
  runners: readonly RunnerNode[] = [],
): ProcessLane[] {
  const live = fleet.filter((f) => !DEAD_STATES.has(f.state));
  const pick = (states: readonly string[]): string | null => {
    let best: string | null = null;
    let bestRank = Infinity;
    for (const st of states) {
      const rank = STATE_URGENCY[st] ?? 90;
      if (rank < bestRank) { bestRank = rank; best = st; }
    }
    return best;
  };
  const fleetState = pick(live.map((f) => f.state));
  const runnerState = pick(runners.map((r) => r.status));
  return [
    {
      key: 'fleet',
      count: live.length,
      ink: fleetState ? FLEET_INK[fleetState] ?? 'var(--status-neutral)' : 'var(--status-neutral)',
      state: fleetState,
      attention: live.some((f) => needsOperator(f.state)),
    },
    {
      key: 'persona',
      count: personas.length,
      ink: PERSONA_INK,
      // A persona execution has no per-item state on the canvas — it is either
      // in progress or it is not in the list at all.
      state: null,
      attention: false,
    },
    {
      key: 'runner',
      count: runners.length,
      ink: RUNNER_INK,
      state: runnerState,
      attention: false,
    },
  ];
}

/** Average progress across a lane's RUNNING dev-runner tasks (0–1), or null
 *  when nothing is running. Queued tasks are excluded — averaging their 0%
 *  into the bar would read as "this work has stalled" rather than "not started". */
export function runnerProgress(runners: readonly RunnerNode[] = []): number | null {
  const running = runners.filter((r) => r.status === 'running');
  if (running.length === 0) return null;
  let sum = 0;
  for (const r of running) sum += Math.max(0, Math.min(100, r.progress));
  return sum / running.length / 100;
}
