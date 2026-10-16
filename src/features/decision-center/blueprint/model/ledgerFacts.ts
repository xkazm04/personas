// What the In packs table, the decision bar and the matrix need of every pack item (PORTED from bp
// src/components/ledger/train/ItemRow.tsx useItemFacts, as a pure function): the verdict (compare.ts verdictOf,
// noise-aware), before / after of its own metric, its screens and runs, the attempt chain, and whether it failed or
// would ship flagged. One pass over the measurements and the shots.
import { runStats, verdictOf, type LensFields, type Verdict } from '@/lib/lensScan/compare';
import type { Measurement, Proposal, ScanSnapshot } from '@/lib/lensScan/wire';
import { isFlagged } from './ledgerRules';

export interface ItemFacts {
  verdict: Verdict;
  /** The before reading (the baseline runs' median when there are several) and the latest after, of its own metric. */
  before?: number;
  after?: number;
  unit?: string;
  /** Screens captured for it (each phase of each theme and size). */
  shots: number;
  /** Baseline runs of its metric (more than one: a performance probe) and after readings. */
  runs: number;
  afters: number;
  /** 1 for a first build; a rework rebuild counts its chain of `attempt_of`. */
  attempt: number;
  /** The previous attempt and the note it was sent back with. */
  prev?: string;
  prevNote?: string;
  /** Its build failed (status failed, or accepted from failed). */
  failed: boolean;
  /** Accepted although it failed or its metric did not move. */
  flagged: boolean;
}

export function itemFacts(scan: Pick<ScanSnapshot, 'proposals' | 'measurements' | 'shots'>, lenses: readonly LensFields[]): Map<string, ItemFacts> {
  const ev = new Map<string, { before: Measurement[]; after: Measurement[]; shots: Set<string> }>();
  const of = (id: string) => { let e = ev.get(id); if (!e) ev.set(id, (e = { before: [], after: [], shots: new Set() })); return e; };
  for (const m of scan.measurements) if (m.proposal_id && m.phase) of(m.proposal_id)[m.phase].push(m);
  for (const s of scan.shots) if (s.proposal_id && s.phase) of(s.proposal_id).shots.add(s.phase + '\u0000' + (s.theme ?? '') + '\u0000' + (s.size ?? ''));
  const byId = new Map(scan.proposals.map((p) => [p.id, p]));
  const out = new Map<string, ItemFacts>();
  for (const p of scan.proposals) {
    if (!p.pack_id) continue;
    const e = ev.get(p.id), v = verdictOf(p, e?.before ?? [], e?.after ?? [], lenses);
    const mine = (m: Measurement) => m.lens === p.lens && m.metric === p.metric;
    const base = (e?.before ?? []).filter(mine);
    const f: ItemFacts = { verdict: v.verdict, shots: e?.shots.size ?? 0, runs: base.length, afters: (e?.after ?? []).filter(mine).length, attempt: 1, failed: false, flagged: false };
    const before = base.length > 1 ? runStats(base.map((m) => m.value), v.from?.unit).median : v.from?.value;
    if (before !== undefined) f.before = before;
    if (v.to) f.after = v.to.value;
    const unit = v.from?.unit ?? v.to?.unit;
    if (unit) f.unit = unit;
    let a: Proposal | undefined = p;
    while (a?.attempt_of && f.attempt < 50) { f.attempt++; a = byId.get(a.attempt_of); }
    if (p.attempt_of) { f.prev = p.attempt_of; const n = byId.get(p.attempt_of)?.triage_note; if (n) f.prevNote = n; }
    // the status before the triage tells a failed build once it is accepted
    const was = p.status === 'accepted' ? p.triaged_from ?? p.status : p.status;
    f.failed = was === 'failed';
    f.flagged = p.status === 'accepted' && isFlagged({ status: was }, v.verdict);
    out.set(p.id, f);
  }
  return out;
}
