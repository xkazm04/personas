import type { DevInstance } from '../../engine/devAdapter';
import type { SpineModel } from '../../engine/spine';

/**
 * Where every session of a view ends on the Watershed: a marsh (it left the river failing), a
 * lake (it left clean) or a delta mouth (it walked the whole path to the sea).
 *
 * The PATH is never derived here: it is read from the engine's model (`model.stations[].keys`),
 * so the river is the spine and nothing else. What the engine keeps private and the map needs
 * per session (how far it reached, which stations it matched, where it stumbled) is the same
 * alignment rule `spine.ts` applies, replayed against that path; `fates.test.ts` holds the two
 * to the same counts.
 */

export type SeaOutcome = 'landed' | 'quiet' | 'interrupted' | 'errored';
/** The order the delta's mouths run top to bottom; failures sit nearest the marshes. */
export const SEA_ORDER: readonly SeaOutcome[] = ['landed', 'quiet', 'interrupted', 'errored'];

export interface SessionTrack {
  reach: number;
  /** Per station: matched on the path (true), skipped (false); stations past `reach` are false. */
  matched: boolean[];
  /** Stations where the session stumbled (an error or interrupt filed there). */
  frictionAt: number[];
  /** Ended before the last station. */
  ended: boolean;
  /** The station its failed outcome is filed at, or null when it did not fail. */
  exitQ: number | null;
}

export interface StationDetail {
  waits: number[];
  exitIds: string[];
  frictionIds: string[];
}

export type Fate = { type: 'marsh' | 'lake'; q: number } | { type: 'sea'; o: SeaOutcome };

export interface Fates {
  per: Map<string, SessionTrack>;
  stations: StationDetail[];
  /** Per station: ids that left the river there clean (lake) and failing (marsh). */
  clean: string[][];
  fail: string[][];
  sea: Record<SeaOutcome, string[]>;
  fate: Map<string, Fate>;
  /** The conserved lane of each session across the river's width, top to bottom. */
  lanes: Map<string, number>;
  seaStart: Record<SeaOutcome, number>;
}

type Token = { tok: string; t: number };

function tokenize(inst: DevInstance): Token[] {
  const seen = new Set<string>();
  const out: Token[] = [];
  for (const st of inst.steps) {
    if (seen.has(st.k)) continue;
    seen.add(st.k);
    out.push({ tok: st.k, t: st.t });
  }
  return out;
}

function track(inst: DevInstance, path: string[][], where: Map<string, number>) {
  const matched: (Token | null)[] = path.map(() => null);
  const waits: (number | undefined)[] = [];
  let p = 0, lastT = 0;
  for (const tk of tokenize(inst)) {
    const q = where.get(tk.tok);
    if (q != null && q >= p) { matched[q] = tk; waits[q] = tk.t - lastT; lastT = tk.t; p = q + 1; }
  }
  const frictionAt: number[] = [];
  for (const st of inst.steps) {
    if (!st.friction && st.err <= 0) continue;
    let at = where.get(st.k);
    if (at == null) {
      at = 0;
      matched.forEach((m, q) => { if (m && m.t <= st.t) at = q; });
    }
    if (!frictionAt.includes(at)) frictionAt.push(at);
  }
  return { reach: p, matched, waits, frictionAt };
}

/** Align a view against its model's path and sort every session to where it ends on the map. */
export function surveyFates(list: DevInstance[], model: SpineModel, isFailure: (o: string) => boolean): Fates {
  const path = model.stations.map((s) => s.keys);
  const N = path.length;
  const where = new Map<string, number>();
  path.forEach((pos, q) => pos.forEach((t) => where.set(t, q)));
  const stations: StationDetail[] = path.map(() => ({ waits: [], exitIds: [], frictionIds: [] }));
  const per = new Map<string, SessionTrack>();
  const clean: string[][] = path.map(() => []);
  const fail: string[][] = path.map(() => []);
  const sea: Record<SeaOutcome, string[]> = { landed: [], quiet: [], interrupted: [], errored: [] };
  const fate = new Map<string, Fate>();

  for (const inst of list) {
    const a = track(inst, path, where);
    for (let q = 1; q < a.reach; q++) {
      const w = a.waits[q];
      if (a.matched[q] && a.matched[q - 1] && w != null) stations[q]!.waits.push(w);
    }
    for (const q of a.frictionAt) stations[q]?.frictionIds.push(inst.id);
    const ended = a.reach < N;
    const exitQ = Math.max(0, (ended ? a.reach : N) - 1);
    const failed = isFailure(inst.outcome) && N > 0;
    if (failed) stations[exitQ]!.exitIds.push(inst.id);
    per.set(inst.id, {
      reach: a.reach,
      matched: a.matched.map((m, q) => q < a.reach && m != null),
      frictionAt: a.frictionAt,
      ended,
      exitQ: failed ? exitQ : null,
    });
    if (!N) continue;
    if (ended) {
      const q = Math.max(0, a.reach - 1);
      (isFailure(inst.outcome) ? fail : clean)[q]!.push(inst.id);
      fate.set(inst.id, { type: isFailure(inst.outcome) ? 'marsh' : 'lake', q });
    } else {
      const o = (SEA_ORDER as readonly string[]).includes(inst.outcome) ? (inst.outcome as SeaOutcome) : 'quiet';
      sea[o].push(inst.id);
      fate.set(inst.id, { type: 'sea', o });
    }
  }

  // Lanes are conserved: clean leavers ride the top bank, the sea in the middle, failures the
  // bottom bank (the latest marsh innermost), so every departure peels off its own bank.
  const lanes = new Map<string, number>();
  let j = 0;
  for (const ids of clean) for (const id of ids) lanes.set(id, j++);
  const seaStart = { landed: 0, quiet: 0, interrupted: 0, errored: 0 } as Record<SeaOutcome, number>;
  for (const o of SEA_ORDER) { seaStart[o] = j; for (const id of sea[o]) lanes.set(id, j++); }
  for (let q = N - 1; q >= 0; q--) for (const id of fail[q]!) lanes.set(id, j++);

  return { per, stations, clean, fail, sea, fate, lanes, seaStart };
}

/** Whole-mode departures per station, for the dashed ghost banks behind a picked repository. */
export function departureCounts(f: Fates): { clean: number[]; fail: number[] } {
  return { clean: f.clean.map((x) => x.length), fail: f.fail.map((x) => x.length) };
}
