import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import type { CuratorProcessSession } from '@/lib/bindings/CuratorProcessSession';
import { devFailure, type DevInstance } from '../../engine/devAdapter';
import { pct } from '../../labels';
import type { Fate } from './dialFate';

/** The deeper levels of the Dial: what a phase is made of, where it fails, and the sessions behind it. */

const NOT_WORK = new Set(['wait', 'notify']);
const FRICTION = new Set(['interrupt', 'compact']);
const IDLE_CAP_S = 600;

/** A session's raw record, found by the id and mode the cohort carries. */
export function rawIndex(reading: CuratorProcess): Map<string, CuratorProcessSession> {
  const m = new Map<string, CuratorProcessSession>();
  for (const s of reading.sessions) m.set(`${s.mode === 'headless' ? 'headless' : 'interactive'}|${s.id}`, s);
  return m;
}
export const rawOf = (raw: Map<string, CuratorProcessSession>, x: DevInstance) => raw.get(`${x.mode}|${x.id}`);

export interface KindRow { kind: string; calls: number; errors: number; span: number }

/** Which step kinds make up a station: calls and errors per kind, most-used first. */
export function kindBreakdown(view: DevInstance[], raw: Map<string, CuratorProcessSession>, reading: CuratorProcess, keys: string[]): KindRow[] {
  const map = new Map<string, KindRow>();
  for (const x of view) {
    for (const st of rawOf(raw, x)?.steps ?? []) {
      const kind = reading.kinds[st[0]] ?? 'tool';
      if (NOT_WORK.has(kind) || FRICTION.has(kind)) continue;
      if (!keys.includes(reading.phases[kind] ?? kind)) continue;
      const m = map.get(kind) ?? { kind, calls: 0, errors: 0, span: 0 };
      m.calls += st[1];
      m.errors += st[2];
      m.span += st[4];
      map.set(kind, m);
    }
  }
  return [...map.values()].sort((a, b) => b.calls - a.calls);
}

/** Tool-running seconds a session spent in a station's phases, over the sessions that touched it. */
export function phaseTime(view: DevInstance[], raw: Map<string, CuratorProcessSession>, reading: CuratorProcess, keys: string[]) {
  const per: number[] = [];
  for (const x of view) {
    let t = 0;
    let touched = false;
    for (const st of rawOf(raw, x)?.steps ?? []) {
      const kind = reading.kinds[st[0]] ?? 'tool';
      if (NOT_WORK.has(kind) || FRICTION.has(kind)) continue;
      if (keys.includes(reading.phases[kind] ?? kind)) { t += st[4]; touched = true; }
    }
    if (touched) per.push(t);
  }
  const sorted = [...per].sort((a, b) => a - b);
  const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2 : NaN;
  return { total: per.reduce((a, b) => a + b, 0), sessions: per.length, median };
}

export interface RepoAtStation {
  name: string;
  n: number;
  reached: number;
  exits: number;
  exitPct: number | null;
  stumbled: number;
}

/** Which repositories lose sessions at a station of the cohort's path, biggest failing ends first. */
export function rankRepos(cohort: DevInstance[], fates: Map<string, Fate>, q: number): RepoAtStation[] {
  const by = new Map<string, RepoAtStation>();
  for (const x of cohort) {
    const f = fates.get(x.id);
    if (!f) continue;
    const r = by.get(x.project) ?? { name: x.project, n: 0, reached: 0, exits: 0, exitPct: null, stumbled: 0 };
    r.n++;
    if (f.reach > q) r.reached++;
    if (f.exitAt === q && devFailure(x.outcome)) r.exits++;
    if (f.frictionAt.includes(q)) r.stumbled++;
    by.set(x.project, r);
  }
  const out = [...by.values()];
  for (const r of out) r.exitPct = r.reached ? pct(r.exits, r.reached) : null;
  return out.sort((a, b) => b.exits - a.exits || b.stumbled - a.stumbled || b.n - a.n);
}

export type SessionBucket = 'failing' | 'stumbled' | 'quiet';

const newestFirst = (a: DevInstance, b: DevInstance, raw: Map<string, CuratorProcessSession>) =>
  (rawOf(raw, a)?.start ?? '') < (rawOf(raw, b)?.start ?? '') ? 1 : -1;

/** The sessions behind a station's three doors, newest first. */
export function stationSessions(view: DevInstance[], fates: Map<string, Fate>, raw: Map<string, CuratorProcessSession>, q: number): Record<SessionBucket, DevInstance[]> {
  const out: Record<SessionBucket, DevInstance[]> = { failing: [], stumbled: [], quiet: [] };
  for (const x of view) {
    const f = fates.get(x.id);
    if (!f) continue;
    if (f.exitAt === q) {
      if (devFailure(x.outcome)) out.failing.push(x);
      else if (x.outcome === 'quiet') out.quiet.push(x);
    }
    if (f.frictionAt.includes(q)) out.stumbled.push(x);
  }
  for (const k of Object.keys(out) as SessionBucket[]) out[k].sort((a, b) => newestFirst(a, b, raw));
  return out;
}

export const sessionsWithOutcome = (view: DevInstance[], raw: Map<string, CuratorProcessSession>, outcome: string) =>
  view.filter((x) => x.outcome === outcome).sort((a, b) => newestFirst(a, b, raw));

export interface TimelineStep { kind: string; phase: string; calls: number; err: number; at: number; span: number; extra: string | null; work: boolean; friction: boolean }

/** A session's own clock: work steps on the active clock (idle gaps capped at ten minutes), friction events kept. */
export function timeline(s: CuratorProcessSession, reading: CuratorProcess): TimelineStep[] {
  const out: TimelineStep[] = [];
  let active = 0;
  let prevEnd: number | null = null;
  for (const st of s.steps) {
    const kind = reading.kinds[st[0]] ?? 'tool';
    if (prevEnd != null) active += Math.min(Math.max(0, st[3] - prevEnd), IDLE_CAP_S);
    const at = active;
    active += st[4];
    prevEnd = st[3] + st[4];
    out.push({
      kind,
      phase: reading.phases[kind] ?? kind,
      calls: st[1],
      err: st[2],
      at,
      span: st[4],
      extra: st[5],
      work: !NOT_WORK.has(kind) && !FRICTION.has(kind),
      friction: FRICTION.has(kind),
    });
  }
  return out;
}
