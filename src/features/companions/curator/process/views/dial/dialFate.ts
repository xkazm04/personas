import { devFailure, type DevInstance, type DevOutcome } from '../../engine/devAdapter';

/**
 * Where each session of a cohort stood against the standard path.
 *
 * The engine's `buildSpine` answers per station (how many reached, ended, stumbled) but keeps no
 * per-session record, and the Dial needs one: a ring is cut by what happened to the sessions that
 * reached it, and the deeper levels list the sessions behind a figure. The PATH is never derived
 * here - it is handed in from `model.stations[].keys`. Only the alignment is repeated, line for
 * line the engine's rule (first occurrence of each phase, in order; friction belongs to the step it
 * happened in), and `dialFate.test.ts` pins the agreement against `buildSpine`'s own counts.
 */
export interface Fate {
  /** Stations walked: the session reached station q when q < reach. */
  reach: number;
  /** The station its ending is filed at (the last one reached). */
  exitAt: number;
  /** True when it left the path before the last station. */
  ended: boolean;
  /** Stations at which a tool error or interrupt happened. */
  frictionAt: number[];
}

export type Departures = Record<DevOutcome, number>[];

export function fateOf(inst: DevInstance, keys: string[][]): Fate {
  const where = new Map<string, number>();
  keys.forEach((pos, q) => pos.forEach((k) => where.set(k, q)));
  const seen = new Set<string>();
  const matchedAt: (number | null)[] = keys.map(() => null);
  let p = 0;
  for (const st of inst.steps) {
    if (seen.has(st.k)) continue;
    seen.add(st.k);
    const q = where.get(st.k);
    if (q != null && q >= p) {
      matchedAt[q] = st.t;
      p = q + 1;
    }
  }
  const frictionAt: number[] = [];
  for (const st of inst.steps) {
    if (!st.friction && st.err <= 0) continue;
    let at = where.get(st.k);
    if (at == null) {
      at = 0;
      matchedAt.forEach((t, q) => { if (t != null && t <= st.t) at = q; });
    }
    if (!frictionAt.includes(at)) frictionAt.push(at);
  }
  const ended = p < keys.length;
  return { reach: p, ended, exitAt: Math.max(0, (ended ? p : keys.length) - 1), frictionAt };
}

export function fatesOf(list: DevInstance[], keys: string[][]): Map<string, Fate> {
  const out = new Map<string, Fate>();
  for (const inst of list) out.set(inst.id, fateOf(inst, keys));
  return out;
}

/** How the sessions that stopped at each station ended, for the ring's cut. */
export function departuresOf(list: DevInstance[], fates: Map<string, Fate>, stations: number): Departures {
  const out: Departures = Array.from({ length: stations }, () => ({ landed: 0, quiet: 0, errored: 0, interrupted: 0 }));
  for (const inst of list) {
    const f = fates.get(inst.id);
    const row = f && out[f.exitAt];
    // Invariant: `devInstances` assigns every session one of the four DevOutcome values.
    if (row) row[inst.outcome as DevOutcome]++;
  }
  return out;
}

/** The sessions that ended failing at station q (an errored or interrupted ending filed there). */
export const failsAt = (inst: DevInstance, f: Fate | undefined, q: number) => !!f && f.exitAt === q && devFailure(inst.outcome);
