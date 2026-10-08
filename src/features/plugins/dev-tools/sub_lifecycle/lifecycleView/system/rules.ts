// The judging rules as lookups. The backend ships the rules it judges by on
// every snapshot (`snapshot.rules`: default budgets per command kind, the
// thresholds, the kinds each command-running step measures), so the UI draws
// its budget lines, threshold lines and editor choices against the real values
// and keeps no copy of its own. A step's own params override a default.
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';
import type { LifecycleMetricKey } from '@/lib/bindings/LifecycleMetricKey';
import type { LifecycleRulesView } from '@/lib/bindings/LifecycleRulesView';
import type { LifecycleStepParams } from '@/lib/bindings/LifecycleStepParams';

/** A kind's default budget in ms, or null when the rules name none for it. */
export function defaultBudgetMs(rules: LifecycleRulesView, kind: LifecycleGateKind): number | null {
  return rules.defaultBudgets.find((b) => b.kind === kind)?.budgetMs ?? null;
}

/** A command's budget: its own override, else its kind's default (null when neither is known). */
export function budgetFor(rules: LifecycleRulesView, kind: LifecycleGateKind, own: number | null): number | null {
  return own ?? defaultBudgetMs(rules, kind);
}

/** The command kinds a step measures (empty for a step that runs no commands). */
export function kindsForStep(rules: LifecycleRulesView, stepId: string): LifecycleGateKind[] {
  return rules.stepKinds.find((s) => s.stepId === stepId)?.kinds ?? [];
}

export interface StepThresholds {
  coverageGreenPct: number;
  docsCleanPct: number;
  doneRatePct: number;
  amberFloorPct: number;
}

/**
 * The green line a rate is drawn against: the threshold whose NAME says it
 * judges that metric (coverage -> `coverageGreenPct`, docs clean ->
 * `docsCleanPct`, done rate -> `doneRatePct`). A pass rate has no threshold in
 * the rules, so it draws none; a time is not a rate.
 */
export function greenLineFor(key: LifecycleMetricKey, t: StepThresholds): number | null {
  switch (key) {
    case 'coverage_pct': return t.coverageGreenPct;
    case 'docs_clean_pct': return t.docsCleanPct;
    case 'done_rate': return t.doneRatePct;
    default: return null;
  }
}

/** The thresholds a step is judged by: its own params where it sets them, the rules' defaults otherwise. */
export function thresholdsFor(rules: LifecycleRulesView, params: LifecycleStepParams): StepThresholds {
  return {
    coverageGreenPct: params.coverageGreenPct ?? rules.coverageGreenPct,
    docsCleanPct: params.docsCleanPct ?? rules.docsCleanPct,
    doneRatePct: params.doneRatePct ?? rules.doneRatePct,
    amberFloorPct: rules.amberFloorPct,
  };
}
