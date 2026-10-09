/**
 * NEXT BEST ACTION: what to do about one step, derived from its data alone.
 * Pure: no React, no i18n, no IO. The step screen draws the plan under its
 * band (`NextPanel`); the unit test reads the same function.
 *
 * Rules, each one a thing the data already says:
 *
 * - a command whose latest run FAILED: its first error, and the way to the run;
 * - a command whose latest PASSING run took longer than its budget: by how
 *   much, and the slow-gate backlog item already filed about it (`related`),
 *   else the budget to edit;
 * - Tests with coverage never measured and no coverage command: add one;
 * - a STALE step, or a command step never measured: Measure now;
 * - docs broken or out of date: which ones, to hand to Athena, with the
 *   doc-rot items already filed;
 * - an evidence step under its done-rate target: the most common reason its
 *   changes skipped it, to hand to Athena as a practice change;
 * - an evidence step with too few changes to judge: how many more it needs.
 *
 * Ordered by IMPACT (a failure outranks a slow pass; a broken doc outranks a
 * stale one), at most {@link NEXT_CAP}. A healthy step with nothing to do gets
 * one calm line and no actions. The Overseer's own items about the step are
 * carried beside the plan, never as an action: it is already working on them.
 */
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';
import type { LifecycleRulesView } from '@/lib/bindings/LifecycleRulesView';
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';
import type { LifecycleStepParams } from '@/lib/bindings/LifecycleStepParams';

import { expectedMetricKeys, type HealthStep } from '../../layer1/healthModel';
import { commandRows, type CommandRow } from '../../presets/gateModel';
import { kindsForStep, thresholdsFor } from '../../system/rules';
import { changeStreak, commonSkipReason, measureStreak } from './nextEvidence';

export { changeStreak, commonSkipReason, measureStreak } from './nextEvidence';

/** The most actions a plan carries. */
export const NEXT_CAP = 3;

export type NextAction =
  | { kind: 'failing'; commandId: string; command: string; error: string | null }
  | { kind: 'over_budget'; commandId: string; command: string; overMs: number; budgetMs: number; item: LifecycleRelatedItem | null }
  | { kind: 'add_coverage' }
  | { kind: 'measure'; why: 'stale' | 'never' }
  | { kind: 'fix_docs'; broken: string[]; stale: string[]; items: LifecycleRelatedItem[] }
  | { kind: 'adjust_practice'; reason: string | null; count: number; donePct: number; targetPct: number }
  | { kind: 'more_evidence'; have: number; need: number };

export type NextKind = NextAction['kind'];

/** A run of green verdicts, newest back: Measures for a command step, changes for an evidence step. */
export interface HealthyStreak {
  count: number;
  unit: 'measures' | 'changes';
}

export interface NextPlan {
  actions: NextAction[];
  /** Present only when the step is green and nothing needs doing. */
  healthy: { streak: HealthyStreak | null } | null;
  /** The Overseer's items about this step, open first. */
  overseer: LifecycleRelatedItem[];
}

export interface NextInput {
  step: HealthStep;
  params: LifecycleStepParams;
  rules: LifecycleRulesView;
  detail: LifecycleStepDetail | null;
  /** The Measure history, oldest first (`timeline`); empty when unread. */
  columns: LifecycleMeasureColumn[];
}

/** Higher first. A broken doc and a missing coverage command each keep a step from green outright. */
const IMPACT: Record<NextKind, number> = {
  failing: 100,
  fix_docs: 90,
  add_coverage: 85,
  adjust_practice: 80,
  over_budget: 60,
  measure: 50,
  more_evidence: 30,
};

/** An item still being worked: not decided against and not done. */
const OPEN_STATUSES: ReadonlySet<string> = new Set(['pending', 'accepted']);

export function isOpenItem(item: LifecycleRelatedItem): boolean {
  return OPEN_STATUSES.has(item.status);
}

function isEvidenceStep(stepId: string): boolean {
  return expectedMetricKeys(stepId).includes('done_rate');
}

function commandActions(rows: CommandRow[], related: LifecycleRelatedItem[]): NextAction[] {
  const out: NextAction[] = [];
  for (const r of rows) {
    const run = r.latest;
    if (!run) continue;
    if (run.outcome === 'failed') {
      out.push({ kind: 'failing', commandId: r.commandId, command: r.command, error: r.firstError });
    } else if (run.outcome === 'passed' && r.budgetMs != null && run.durationMs > r.budgetMs) {
      const item = related.find((i) => i.source === 'slow_gate' && i.commandId === r.commandId) ?? null;
      out.push({ kind: 'over_budget', commandId: r.commandId, command: r.command, overMs: run.durationMs - r.budgetMs, budgetMs: r.budgetMs, item });
    }
  }
  return out;
}

function hasCoverageCommand(params: LifecycleStepParams, rows: CommandRow[]): boolean {
  return (params.commands ?? []).some((c) => c.kind === 'coverage') || rows.some((r) => r.kind === 'coverage');
}

function docsAction(docs: LifecycleDocRow[], related: LifecycleRelatedItem[]): NextAction | null {
  const broken = docs.filter((d) => d.status === 'broken').map((d) => d.docPath);
  const stale = docs.filter((d) => d.status === 'stale').map((d) => d.docPath);
  if (broken.length + stale.length === 0) return null;
  return { kind: 'fix_docs', broken, stale, items: related.filter((i) => i.source === 'doc_rot') };
}

function streakOf(input: NextInput): HealthyStreak | null {
  const id = input.step.node.id;
  const measures = measureStreak(input.columns, id);
  if (measures != null && measures > 0) return { count: measures, unit: 'measures' };
  if (isEvidenceStep(id)) {
    const changes = changeStreak(input.detail?.evidence ?? [], id);
    if (changes > 0) return { count: changes, unit: 'changes' };
  }
  return null;
}

const MEASURABLE: ReadonlySet<LifecycleHealth> = new Set(['green', 'amber', 'red', 'stale']);

export function nextPlan(input: NextInput): NextPlan {
  const { step, params, rules, detail } = input;
  const id = step.node.id;
  const related = detail?.related ?? [];
  const overseer = related.filter((i) => i.source === 'overseer');
  const actions: NextAction[] = [];

  const commandStep = kindsForStep(rules, id).length > 0;
  const rows = commandStep ? commandRows(detail?.runs ?? [], params.commands, rules) : [];
  actions.push(...commandActions(rows, related));

  if (id === 'tests') {
    const coverage = step.metrics.find((m) => m.key === 'coverage_pct');
    if (coverage && coverage.value == null && !hasCoverageCommand(params, rows)) actions.push({ kind: 'add_coverage' });
  }
  if (step.health === 'stale') actions.push({ kind: 'measure', why: 'stale' });
  else if (commandStep && step.health === 'unmeasured' && !actions.some((a) => a.kind === 'add_coverage')) {
    actions.push({ kind: 'measure', why: 'never' });
  }

  if (id === 'docs') {
    const docs = docsAction(detail?.docs ?? [], related);
    if (docs) actions.push(docs);
  }

  if (isEvidenceStep(id)) {
    const done = step.metrics.find((m) => m.key === 'done_rate');
    const target = thresholdsFor(rules, params).doneRatePct;
    if (done?.value != null && MEASURABLE.has(step.health) && done.value < target) {
      const { reason, count } = commonSkipReason(detail?.evidence ?? [], id);
      actions.push({ kind: 'adjust_practice', reason, count, donePct: done.value, targetPct: target });
    } else if (step.health === 'unmeasured' && done && done.samples < rules.minSamples) {
      actions.push({ kind: 'more_evidence', have: done.samples, need: rules.minSamples });
    }
  }

  const ranked = actions
    .map((a, i) => ({ a, i, w: a.kind === 'fix_docs' && a.broken.length === 0 ? IMPACT.over_budget - 5 : IMPACT[a.kind] }))
    .sort((x, y) => y.w - x.w || x.i - y.i)
    .slice(0, NEXT_CAP)
    .map((x) => x.a);

  const healthy = ranked.length === 0 && step.health === 'green' ? { streak: streakOf(input) } : null;
  const openFirst = [...overseer].sort((a, b) => Number(isOpenItem(b)) - Number(isOpenItem(a)));
  return { actions: ranked, healthy, overseer: openFirst };
}
