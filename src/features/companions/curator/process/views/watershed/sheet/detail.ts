import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import type { CuratorProcessSession } from '@/lib/bindings/CuratorProcessSession';

/**
 * Read-only detail for the survey sheet, straight from the reading: the raw step kinds inside a
 * station, a session's step sequence on the active-time clock, and the wait histogram. The
 * station membership is the engine's phase map (`reading.phases`); nothing here re-derives a path.
 */

const NOT_WORK = new Set(['wait', 'notify']);
const FRICTION = new Set(['interrupt', 'compact']);
/** The adapter's idle cap: a gap longer than ten minutes counts as ten minutes. */
const IDLE_CAP_S = 600;

export interface RawStep { kind: string; phase: string; n: number; err: number; t: number; span: number }

const byIdCache = new WeakMap<CuratorProcess, Map<string, CuratorProcessSession>>();
export function sessionById(reading: CuratorProcess, id: string): CuratorProcessSession | undefined {
  let m = byIdCache.get(reading);
  if (!m) { m = new Map(reading.sessions.map((s) => [s.id, s])); byIdCache.set(reading, m); }
  return m.get(id);
}

export function rawSteps(reading: CuratorProcess, s: CuratorProcessSession): RawStep[] {
  const out: RawStep[] = [];
  let active = 0, prevEnd: number | null = null;
  for (const [ki, n, err, tStart, span] of s.steps) {
    const kind = reading.kinds[ki] ?? 'tool';
    if (prevEnd != null) active += Math.min(Math.max(0, tStart - prevEnd), IDLE_CAP_S);
    out.push({ kind, phase: reading.phases[kind] ?? kind, n, err, t: active, span });
    active += span;
    prevEnd = tStart + span;
  }
  return out;
}

export interface KindRow { kind: string; steps: number; sessions: number; errors: number; errSessions: number; time: number }

/** The raw step kinds of a station's phases, over the sessions on screen. */
export function stationKinds(reading: CuratorProcess, ids: readonly string[], keys: readonly string[]): KindRow[] {
  const m = new Map<string, KindRow>();
  const keyset = new Set(keys);
  for (const id of ids) {
    const s = sessionById(reading, id);
    if (!s) continue;
    const seen = new Map<string, 1 | 2>();
    for (const [ki, n, err, , span] of s.steps) {
      const kind = reading.kinds[ki] ?? 'tool';
      if (NOT_WORK.has(kind) || FRICTION.has(kind)) continue;
      if (!keyset.has(reading.phases[kind] ?? kind)) continue;
      let e = m.get(kind);
      if (!e) { e = { kind, steps: 0, sessions: 0, errors: 0, errSessions: 0, time: 0 }; m.set(kind, e); }
      e.steps += n; e.errors += err; e.time += span;
      if (!seen.has(kind)) { seen.set(kind, 1); e.sessions++; }
      if (err > 0 && seen.get(kind) !== 2) { seen.set(kind, 2); e.errSessions++; }
    }
  }
  return [...m.values()].sort((a, b) => b.steps - a.steps);
}

/** Wait histogram bins in seconds: [from, to). */
export const WAIT_BINS: readonly [number, number][] = [[0, 2], [2, 5], [5, 15], [15, 60], [60, 300], [300, 900], [900, Infinity]];

export function waitBins(waits: readonly number[]): number[] {
  return WAIT_BINS.map(([a, b]) => waits.filter((w) => w >= a && w < b).length);
}

/** Consecutive steps of one kind folded into runs, for the condensed sequence. */
export function runsOf(steps: readonly RawStep[]): { kind: string; n: number; err: number }[] {
  const runs: { kind: string; n: number; err: number }[] = [];
  for (const r of steps) {
    const last = runs[runs.length - 1];
    if (last && last.kind === r.kind) { last.n += r.n; last.err += r.err; } else runs.push({ kind: r.kind, n: r.n, err: r.err });
  }
  return runs;
}
