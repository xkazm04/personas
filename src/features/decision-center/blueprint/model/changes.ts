// What changed between two reads of the scan store, in the ids that name it. PURE: the diff reads two snapshots and
// returns entries; it keeps no state, so the same two snapshots always answer the same list, and two identical ones
// answer nothing. Each entry carries a `key` that is unique to the EVENT (proposal id + the status it moved to, run id
// + its new status, the newest reading id of a feature and lens), so a seen-set keyed by it can never announce the same
// event twice however often the store re-delivers the rows.
import type { ProposalStatus, RunPhase, RunStatus, ScanSnapshot } from '@/lib/lensScan/wire';

export type Change =
  /** A proposal moved from one status to another. */
  | { key: string; kind: 'status'; id: string; fid: string; lens: string; title: string; from: ProposalStatus; to: ProposalStatus }
  /** A proposal that was not in the previous read. */
  | { key: string; kind: 'proposed'; id: string; fid: string; lens: string; title: string; status: ProposalStatus }
  /** A run that ended (`from` running) or appeared (`from` null); `to` is its status now. */
  | { key: string; kind: 'run'; id: string; from: RunStatus | null; to: RunStatus; phase: RunPhase; lenses: string[] }
  /** New readings of one feature under one lens (the before/after captures of a proposal are evidence, not readings). */
  | { key: string; kind: 'readings'; fid: string; lens: string; count: number };

/** The feature a change stands on (highlighted on the plan), when it has one. */
export function featureOf(c: Change): string | null {
  return c.kind === 'run' ? null : c.fid;
}

/** The proposal a change concerns (highlighted in the queue), when it concerns one. */
export function proposalOf(c: Change): string | null {
  return c.kind === 'status' || c.kind === 'proposed' ? c.id : null;
}

/** Every change from `prev` to `next`, runs first, then proposals, then readings. Empty when nothing is new. */
export function diffScan(prev: ScanSnapshot, next: ScanSnapshot): Change[] {
  if (prev === next) return [];
  const out: Change[] = [];

  const runs = new Map(prev.runs.map((r) => [r.id, r]));
  for (const r of next.runs) {
    const was = runs.get(r.id);
    if (!was) out.push({ key: `r:${r.id}:${r.status === 'running' ? 'new' : r.status}`, kind: 'run', id: r.id, from: null, to: r.status, phase: r.phase, lenses: r.lenses });
    else if (was.status === 'running' && r.status !== 'running') out.push({ key: `r:${r.id}:${r.status}`, kind: 'run', id: r.id, from: 'running', to: r.status, phase: r.phase, lenses: r.lenses });
  }

  const props = new Map(prev.proposals.map((p) => [p.id, p]));
  for (const p of next.proposals) {
    const was = props.get(p.id), title = p.title || p.id;
    if (!was) out.push({ key: `p:${p.id}:new`, kind: 'proposed', id: p.id, fid: p.feature, lens: p.lens, title, status: p.status });
    else if (was.status !== p.status) out.push({ key: `p:${p.id}:${p.status}`, kind: 'status', id: p.id, fid: p.feature, lens: p.lens, title, from: was.status, to: p.status });
  }

  const known = new Set(prev.measurements.map((m) => m.id));
  const groups = new Map<string, { fid: string; lens: string; count: number; last: number }>();
  for (const m of next.measurements) {
    if (m.phase || known.has(m.id)) continue;
    const k = m.feature + '|' + m.lens, g = groups.get(k);
    if (g) { g.count++; g.last = Math.max(g.last, m.id); } else groups.set(k, { fid: m.feature, lens: m.lens, count: 1, last: m.id });
  }
  for (const g of groups.values()) out.push({ key: `m:${g.fid}:${g.lens}:${g.last}`, kind: 'readings', fid: g.fid, lens: g.lens, count: g.count });
  return out;
}
