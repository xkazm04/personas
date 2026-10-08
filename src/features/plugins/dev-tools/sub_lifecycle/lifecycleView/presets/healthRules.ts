/**
 * The judging constants Layer 2 draws against, in ONE place. The backend
 * judges every step (src-tauri/src/lifecycle/health.rs) and ships the
 * verdict on the snapshot; the UI only needs these numbers to DRAW the
 * budget line on a run's bar, the threshold lines on a trend, and the kinds a
 * commands-editor row may pick. The contract carries none of them (only a
 * command's own `budgetMs` override and a step's optional thresholds), so
 * they are restated here, and `__tests__/healthRulesParity.test.ts` reads
 * the Rust source at run time and fails when the two disagree.
 */
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';

/** Each command kind's default time budget, ms (`default_budget_ms`). */
export const DEFAULT_BUDGET_MS = {
  lint: 60_000,
  typecheck: 60_000,
  test: 300_000,
  other: 300_000,
  check: 600_000,
  coverage: 600_000,
} as const satisfies Record<LifecycleGateKind, number>;

/** The kinds each command-running step measures (`detect_commands::kinds_of`). */
export const STEP_KINDS: Readonly<Record<string, readonly LifecycleGateKind[]>> = {
  gate: ['lint', 'typecheck', 'check', 'other'],
  tests: ['test', 'coverage'],
};

export const DEFAULT_COVERAGE_GREEN_PCT = 70;
export const DEFAULT_DOCS_CLEAN_PCT = 90;
export const DEFAULT_DONE_RATE_PCT = 80;
/** The amber floor shared by coverage and done rate (`AMBER_FLOOR_PCT`). */
export const AMBER_FLOOR_PCT = 50;

export function kindsForStep(stepId: string): readonly LifecycleGateKind[] {
  return STEP_KINDS[stepId] ?? [];
}
