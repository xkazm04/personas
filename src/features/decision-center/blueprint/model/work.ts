// The scan store's work, read against the plan: one WorkItem per proposal whose feature is on the plan; the rest are kept in `offPlan`.
// Status is ALWAYS the store's (`row.status`): the drawing never decides on its own what a transition did.
import type { Feature } from '../standard/load';
import type { Measurement, Pack, Proposal, ProposalStatus, Run, ScanSnapshot } from '@/lib/lensScan/wire';
import type { Layout } from './layout';

export interface WorkItem {
  id: string;
  row: Proposal;
  /** The feature it concerns; always on the plan (items for unknown features are not drawn). */
  f: Feature;
  fid: string;
  lens: string;
  metric: string | undefined;
  title: string;
  body: string;
  size: string;
  risk: number | undefined;
  /** The expected change of the metric. */
  delta: number | undefined;
  /** The metric's latest reading at or before the proposal was filed; absent when there was none (never a later reading). */
  before: number | undefined;
  unit: string;
  status: ProposalStatus;
  pack: string | undefined;
  created: string;
}

export interface Work {
  items: WorkItem[];
  /** Proposals whose feature has no tile on the plan: counted and named, never drawn (absent in a hand-built stub). */
  offPlan?: Proposal[];
  byId: Map<string, WorkItem>;
  byFeature: Map<string, WorkItem[]>;
  packs: Pack[];
  runs: Run[];
  /** Latest run end (or last move while running); null with no run. */
  lastRun: string | null;
  activeRuns: number;
  /** A feature's readings of one metric, oldest first (not the before/after captures of a proposal). */
  series(fid: string, lens: string, metric: string): Measurement[];
  /** The item's phased readings, before first. */
  evidence(id: string): Measurement[];
  /** A pack is drawn when the store has any (a v2 store). */
  packFlow: boolean;
}

/** Statuses that are still the operator's to decide or to build: the Build queue holds exactly these. */
export const QUEUE_STATUSES: readonly ProposalStatus[] = ['proposed', 'approved'];
export const isQueued = (p: WorkItem) => QUEUE_STATUSES.includes(p.status);

export function buildWork(layout: Layout, scan: ScanSnapshot): Work {
  const series = new Map<string, Measurement[]>();
  for (const m of scan.measurements) {
    if (m.phase) continue;
    const k = m.feature + '|' + m.lens + '|' + m.metric;
    const a = series.get(k);
    if (a) a.push(m); else series.set(k, [m]);
  }
  for (const a of series.values()) a.sort((x, y) => (x.measured_at < y.measured_at ? -1 : 1));
  const items: WorkItem[] = [];
  const offPlan: Proposal[] = [];
  for (const p of scan.proposals) {
    const T = layout.TILE[p.feature];
    if (!T) { offPlan.push(p); continue; }
    const ser = series.get(p.feature + '|' + p.lens + '|' + p.metric) ?? [];
    let before: number | undefined;
    for (const m of ser) if (m.measured_at <= p.created_at) before = m.value;
    items.push({
      id: p.id, row: p, f: T.f, fid: p.feature, lens: p.lens, metric: p.metric, title: p.title || p.id, body: p.body ?? '', size: p.size ?? '-',
      risk: p.risk, delta: p.expected_delta, before, unit: ser.length ? ser[ser.length - 1]?.unit ?? '' : '', status: p.status, pack: p.pack_id, created: p.created_at,
    });
  }
  const byId = new Map(items.map((p) => [p.id, p]));
  const byFeature = new Map<string, WorkItem[]>();
  for (const p of items) { const a = byFeature.get(p.fid); if (a) a.push(p); else byFeature.set(p.fid, [p]); }
  let lastRun: string | null = null;
  for (const r of scan.runs) { const t = r.ended_at ?? r.updated_at ?? r.started_at; if (t && (!lastRun || t > lastRun)) lastRun = t; }
  const phased = scan.measurements.filter((m) => m.phase && m.proposal_id);
  return {
    items, offPlan, byId, byFeature, packs: scan.packs, runs: scan.runs, lastRun, series: (fid, lens, metric) => series.get(fid + '|' + lens + '|' + metric) ?? [], activeRuns: scan.runs.filter((r) => r.status === 'running').length,
    evidence: (id) => phased.filter((m) => m.proposal_id === id).sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'before' ? -1 : 1)),
    packFlow: scan.packs.length > 0,
  };
}
