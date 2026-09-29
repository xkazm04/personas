/**
 * Pure model behind the Lifecycle journey: a `LifecycleSnapshot` in, the two
 * lanes of step nodes and the weakest step out. No React, no i18n, no IO, so
 * the interim view and the contest winner that replaces it read the same
 * derivation (and the unit tests pin it).
 */
import type { LifecycleBindingKind } from '@/lib/bindings/LifecycleBindingKind';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecyclePhase } from '@/lib/bindings/LifecyclePhase';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import type { LifecycleSourceKind } from '@/lib/bindings/LifecycleSourceKind';
import type { LifecycleStepTally } from '@/lib/bindings/LifecycleStepTally';
import type { LifecycleStepView } from '@/lib/bindings/LifecycleStepView';

/** Evidence dots drawn under a node. */
export const MAX_DOTS = 8;

/** The dev-task statuses after which an install task no longer holds bindings pending. */
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/**
 * Enforcement strength, strongest first: live > detected > pending > missing
 * > advisory. Advisory is weakest because nothing can refuse it; a missing
 * binding at least names a mechanism that can be installed.
 */
const STATE_STRENGTH: Record<LifecycleBindingState, number> = {
  live: 4,
  detected: 3,
  pending: 2,
  missing: 1,
  advisory: 0,
};

export interface JourneyDot {
  outcome: LifecycleOutcome;
  sourceKind: LifecycleSourceKind;
  sourceRef: string;
  title: string;
  occurredAt: string;
}

export interface JourneyNode {
  id: string;
  /** A custom step's own label; `null` for a built-in step (labelled from i18n by id). */
  label: string | null;
  phase: LifecyclePhase;
  rule: string;
  bindingKinds: LifecycleBindingKind[];
  strongestState: LifecycleBindingState;
  tally: LifecycleStepTally;
  /** Up to {@link MAX_DOTS} outcomes, newest LAST. A change that recorded no outcome for this step reads `unknown`, never `skipped`. */
  lastOutcomes: LifecycleOutcome[];
  /** The same window as `lastOutcomes`, with the evidence each dot came from. */
  dots: JourneyDot[];
  view: LifecycleStepView;
}

export interface JourneyLanes {
  before: JourneyNode[];
  after: JourneyNode[];
}

export interface WeakestStep {
  node: JourneyNode;
  /** Skipped outcomes in the evidence window. */
  skipped: number;
  /** Changes in the evidence window (the denominator of "skipped in N of M"). */
  total: number;
}

/** True while the version's install task is dispatched and not yet terminal. */
export function installInFlight(snapshot: Pick<LifecycleSnapshot, 'installTaskId' | 'installTaskStatus'>): boolean {
  if (!snapshot.installTaskId) return false;
  return !(snapshot.installTaskStatus && TERMINAL_TASK_STATUSES.has(snapshot.installTaskStatus));
}

/** The strongest state among a step's bindings; a step with no bindings is advisory. */
export function strongestState(states: LifecycleBindingState[]): LifecycleBindingState {
  let best: LifecycleBindingState = 'advisory';
  for (const s of states) if (STATE_STRENGTH[s] > STATE_STRENGTH[best]) best = s;
  return best;
}

/**
 * Binding state as the journey should draw it. The backend already reports
 * `pending` for a missing binding while the install task runs; this repeats
 * the rule so an optimistic "install started" state reads the same way.
 */
function effectiveState(state: LifecycleBindingState, pending: boolean): LifecycleBindingState {
  return pending && state === 'missing' ? 'pending' : state;
}

function dotsFor(stepId: string, evidence: LifecycleEvidenceItem[]): JourneyDot[] {
  // `evidence` is newest first; take the newest window, then flip to newest last.
  return evidence
    .slice(0, MAX_DOTS)
    .map((item) => ({
      outcome: item.outcomes.find((o) => o.stepId === stepId)?.outcome ?? 'unknown',
      sourceKind: item.sourceKind,
      sourceRef: item.sourceRef,
      title: item.title,
      occurredAt: item.occurredAt,
    }))
    .reverse();
}

function toNode(view: LifecycleStepView, evidence: LifecycleEvidenceItem[], pending: boolean): JourneyNode {
  const states = view.bindingViews.map((b) => effectiveState(b.state, pending));
  const dots = dotsFor(view.step.id, evidence);
  return {
    id: view.step.id,
    label: view.step.label,
    phase: view.step.phase,
    rule: view.step.rule,
    bindingKinds: view.step.bindings,
    strongestState: strongestState(states),
    tally: view.evidence,
    lastOutcomes: dots.map((d) => d.outcome),
    dots,
    view,
  };
}

/**
 * Snapshot -> the two lanes, in document order. `forcePending` lets the page
 * show missing bindings as pending the moment it dispatched an install, before
 * the refetch lands.
 */
export function buildLanes(snapshot: LifecycleSnapshot, forcePending = false): JourneyLanes {
  const pending = forcePending || installInFlight(snapshot);
  const nodes = snapshot.steps.map((v) => toNode(v, snapshot.evidence, pending));
  return {
    before: nodes.filter((n) => n.phase === 'before'),
    after: nodes.filter((n) => n.phase === 'after'),
  };
}

/** Skipped + failed over observed outcomes. Unknown is not observed, so it never counts as a skip. */
export function skipRate(tally: LifecycleStepTally): number {
  const observed = tally.done + tally.skipped + tally.failed;
  return observed === 0 ? 0 : (tally.skipped + tally.failed) / observed;
}

/**
 * The weakest step: lowest enforcement strength first, then the highest skip
 * rate, then the most skips, then journey order. `null` when even the weakest
 * step is live and was never skipped or failed (nothing to point at).
 */
export function weakest(snapshot: LifecycleSnapshot): WeakestStep | null {
  const { before, after } = buildLanes(snapshot);
  const nodes = [...before, ...after];
  let pick: JourneyNode | null = null;
  for (const n of nodes) {
    if (!pick) { pick = n; continue; }
    const byStrength = STATE_STRENGTH[n.strongestState] - STATE_STRENGTH[pick.strongestState];
    if (byStrength < 0) { pick = n; continue; }
    if (byStrength > 0) continue;
    const byRate = skipRate(n.tally) - skipRate(pick.tally);
    if (byRate > 0 || (byRate === 0 && n.tally.skipped > pick.tally.skipped)) pick = n;
  }
  if (!pick) return null;
  if (pick.strongestState === 'live' && skipRate(pick.tally) === 0) return null;
  return { node: pick, skipped: pick.tally.skipped, total: snapshot.evidence.length };
}

/** Every binding that is `missing`, as `{step id, kind}` pairs in journey order. */
export function missingBindings(snapshot: LifecycleSnapshot): { stepId: string; label: string | null; kind: LifecycleBindingKind }[] {
  const out: { stepId: string; label: string | null; kind: LifecycleBindingKind }[] = [];
  for (const v of snapshot.steps) {
    for (const b of v.bindingViews) {
      if (b.state === 'missing') out.push({ stepId: v.step.id, label: v.step.label, kind: b.kind });
    }
  }
  return out;
}
