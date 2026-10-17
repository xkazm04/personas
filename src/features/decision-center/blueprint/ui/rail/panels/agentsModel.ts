// What the Agents workbench reads, as pure functions over the store's rows (bp agents.tsx jobFacts, re-pointed at
// this repo's data): a lens-scan run's figures from the snapshot, and the runs this sheet started from the dock
// console's lines. Nothing here is invented: a figure the store has no row for is left out, never shown as zero.
import type { ProposalStatus, Run, ScanSnapshot } from '@/lib/lensScan/wire';
import type { ConsoleLine } from '../../../state/uiState';
import type { BpText } from '../../../controller/useBlueprintText';
import type { StartPhase, StartState } from '../../../live/startedModel';

/** A proposal that a build got through: built, then triaged or released (a failed build is not one). */
const BUILT: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['done', 'accepted', 'rework', 'descoped', 'released']);

export type StartLine = Extract<ConsoleLine, { kind: 'start' }>;

export interface RunFacts {
  /** What the run got through: findings built (execute), filed (propose) or features measured (measure, propagate). */
  n: number;
  /** Out of how many, when the run names them (an execute run's scope); null when the store gives no total. */
  m: number | null;
  /** Elapsed (running) or taken (ended), in ms. */
  ms: number;
  open: boolean;
  /** The run's own activity lines, oldest first. */
  lines: ScanSnapshot['activity'];
  readings: number;
}

const ids = (scope: Run['scope'], key: string): string[] | null => {
  const v = scope?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
};

export function runFacts(r: Run, scan: ScanSnapshot, now: number): RunFacts {
  const readings = scan.measurements.filter((m) => m.run_id === r.id);
  const lines = scan.activity.filter((a) => a.run_id === r.id).sort((a, b) => (a.at < b.at ? -1 : 1));
  const named = ids(r.scope, 'proposals');
  let n: number, m: number | null = null;
  if (r.phase === 'execute') {
    const want = new Set(named ?? []);
    n = scan.proposals.filter((p) => want.has(p.id) && BUILT.has(p.status)).length;
    m = named ? named.length : null;
  } else if (r.phase === 'propose') n = scan.proposals.filter((p) => p.run_id === r.id).length;
  else n = new Set(readings.map((x) => x.feature)).size;
  const t0 = Date.parse(r.started_at), t1 = r.ended_at ? Date.parse(r.ended_at) : r.status === 'running' ? now : Date.parse(r.updated_at);
  return { n, m, ms: Math.max(0, t1 - t0), open: r.status === 'running', lines, readings: readings.length };
}

/** What a run was pointed at, in the store's words: a group's name, or how many findings or features it names. */
export function scopeOf(r: Run): { group: string } | { proposals: number } | { features: number } | null {
  const g = r.scope?.group;
  if (typeof g === 'string' && g) return { group: g };
  const p = ids(r.scope, 'proposals');
  if (p) return { proposals: p.length };
  const f = ids(r.scope, 'features');
  if (f) return { features: f.length };
  return null;
}

/** The runs, newest first. */
export const newestFirst = (runs: readonly Run[]): Run[] => runs.slice().sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

export const startLines = (lines: readonly ConsoleLine[]): StartLine[] => lines.filter((l): l is StartLine => l.kind === 'start');

/** The store's runs counted by what they did. `aborted` is its own count: a stopped run is not a failed one. */
export function tallyRuns(runs: readonly Run[]): { running: number; done: number; failed: number; aborted: number } {
  const t = { running: 0, done: 0, failed: 0, aborted: 0 };
  for (const r of runs) t[r.status === 'running' ? 'running' : r.status === 'done' ? 'done' : r.status === 'aborted' ? 'aborted' : 'failed']++;
  return t;
}

/** The word a started build's phase speaks in. */
export function startWord(B: BpText, phase: StartPhase): string {
  return ({ queued: B.started_queued, running: B.started_running, waiting: B.started_waiting, done: B.started_done, failed: B.started_failed, silent: B.started_silent })[phase];
}

/** How long a start has worked (settled: how long it took), in ms. */
export const startElapsed = (st: StartState, now: number): number => Math.max(0, (st.until ?? now) - st.since);
