// Snapshot builders for the journey tests. Shapes follow the WP1 bindings;
// the Solo step list mirrors src-tauri/src/lifecycle/presets.rs.
import type { LifecycleBindingKind } from '@/lib/bindings/LifecycleBindingKind';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleMetricKey } from '@/lib/bindings/LifecycleMetricKey';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecyclePhase } from '@/lib/bindings/LifecyclePhase';
import type { LifecyclePreviousView } from '@/lib/bindings/LifecyclePreviousView';
import type { LifecycleRulesView } from '@/lib/bindings/LifecycleRulesView';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import type { LifecycleStepHealthView } from '@/lib/bindings/LifecycleStepHealthView';
import type { LifecycleStepView } from '@/lib/bindings/LifecycleStepView';

const PARAMS = {
  lint: null, codeQuality: null, docsRequired: null, landMode: null,
  prBase: null, automergeEnabled: null, automergeTarget: null,
  commands: null, coverageGreenPct: null, docsCleanPct: null, doneRatePct: null,
};

export function stepView(
  id: string,
  phase: LifecyclePhase,
  bindings: [LifecycleBindingKind, LifecycleBindingState][],
  tally: Partial<LifecycleStepView['evidence']> = {},
): LifecycleStepView {
  return {
    step: { id, phase, label: null, rule: `Rule for ${id}.`, bindings: bindings.map(([k]) => k), params: PARAMS },
    bindingViews: bindings.map(([kind, state]) => ({ kind, state, detail: null })),
    evidence: { done: 0, skipped: 0, unknown: 0, failed: 0, ...tally },
  };
}

/** The judging rules the backend ships on every snapshot, at their real defaults. */
export const DEFAULT_RULES: LifecycleRulesView = {
  defaultBudgets: [
    { kind: 'lint', budgetMs: 60_000 },
    { kind: 'typecheck', budgetMs: 60_000 },
    { kind: 'test', budgetMs: 300_000 },
    { kind: 'check', budgetMs: 600_000 },
    { kind: 'coverage', budgetMs: 600_000 },
    { kind: 'other', budgetMs: 300_000 },
  ],
  coverageGreenPct: 70,
  docsCleanPct: 90,
  doneRatePct: 80,
  amberFloorPct: 50,
  minSamples: 5,
  stepKinds: [
    { stepId: 'gate', kinds: ['lint', 'typecheck', 'check', 'other'] },
    { stepId: 'tests', kinds: ['test', 'coverage'] },
  ],
};

/** Solo v0 as the backend reports it for a repo with nothing installed (never measured). */
export function soloV0(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
  return {
    projectId: 'p1',
    preset: 'solo',
    version: 0,
    author: 'default',
    changeNote: null,
    createdAt: null,
    installTaskId: null,
    installTaskStatus: null,
    evidence: [],
    health: [],
    goal: null,
    watched: false,
    measuring: false,
    progress: null,
    tip: { branch: 'master', sha: 'a1b2c3d4e5f6', measuredSha: null, commitsBehind: null, measuredAt: null },
    rules: DEFAULT_RULES,
    steps: [
      stepView('frame', 'before', [['app', 'live']]),
      stepView('recall', 'before', [['claude_md', 'detected']]),
      stepView('isolate', 'before', [['app', 'live']]),
      stepView('sync', 'before', [['app', 'live']]),
      stepView('gate', 'after', [['hook', 'detected']]),
      stepView('tests', 'after', [['advisory', 'advisory']]),
      stepView('docs', 'after', [['advisory', 'advisory']]),
      stepView('commit', 'after', [['hook', 'detected']]),
      stepView('land', 'after', [['app', 'live']]),
      stepView('record', 'after', [['app', 'live']]),
    ],
    ...overrides,
  };
}

export function evidenceItem(
  ref: string,
  occurredAt: string,
  outcomes: [string, LifecycleOutcome][],
  sourceKind: LifecycleEvidenceItem['sourceKind'] = 'commit',
): LifecycleEvidenceItem {
  return {
    sourceKind,
    sourceRef: ref,
    title: `Change ${ref}`,
    occurredAt,
    outcomes: outcomes.map(([stepId, outcome]) => ({ stepId, outcome, detail: null })),
  };
}

type HealthRow = LifecycleStepHealthView;

function health(
  stepId: string,
  verdict: HealthRow['health'],
  reason: string | null,
  metrics: [LifecycleMetricKey, number | null, number][] = [],
  measuredAt: string | null = null,
  staleOf: HealthRow['staleOf'] = null,
  previous: LifecyclePreviousView | null = null,
): HealthRow {
  return {
    stepId,
    health: verdict,
    staleOf,
    reason,
    metrics: metrics.map(([key, value, samples]) => ({ key, value, samples })),
    measuredAt,
    headSha: measuredAt ? 'a1b2c3d' : null,
    previous,
  };
}

/** The step as judged one measurement earlier (`previous` on a health row). */
export function prev(
  verdict: HealthRow['health'],
  metrics: [LifecycleMetricKey, number | null, number][] = [],
  measuredAt: string | null = '2026-10-06T09:30:00Z',
): LifecyclePreviousView {
  return {
    health: verdict,
    metrics: metrics.map(([key, value, samples]) => ({ key, value, samples })),
    measuredAt,
    headSha: measuredAt ? '9f8e7d6' : null,
  };
}

/**
 * Solo v0 with a measured pipeline: every one of the six verdicts at least
 * once, realistic metrics, a null metric (sync, below its sample floor), the
 * Overseer goal, and the earlier measure on most steps: isolate and tests
 * improved, gate and land regressed (both changed verdict), commit and record
 * unchanged, sync and docs with none. Mirrored for the page harness by
 * `scripts/style/page-harness/lifecycleTapes.mjs`; keep the two in step.
 */
export function healthyMix(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
  const at = '2026-10-08T09:30:00Z';
  return soloV0({
    health: [
      health('frame', 'instructed', null),
      health('recall', 'instructed', null),
      health('isolate', 'green', null, [['done_rate', 92, 12]], null, null, prev('green', [['done_rate', 86, 12]])),
      health('sync', 'unmeasured', 'Only 3 changes recorded; 5 are needed', [['done_rate', null, 3]]),
      health('gate', 'amber', 'tsc 74s over 60s budget', [['median_ms', 74000, 10], ['pass_rate', 90, 10]], at, null,
        prev('green', [['median_ms', 52000, 10], ['pass_rate', 100, 10]])),
      health('tests', 'amber', 'Coverage 63% is under the 70% target', [['coverage_pct', 63, 1], ['median_ms', 182000, 10], ['pass_rate', 100, 10]], at, null,
        prev('amber', [['coverage_pct', 61, 1], ['median_ms', 190000, 10], ['pass_rate', 100, 10]])),
      health('docs', 'green', null, [['docs_clean_pct', 92, 38]], at),
      health('commit', 'stale', 'Last measured on an older base tip', [['done_rate', 85, 12]], '2026-10-01T09:30:00Z', 'green',
        prev('green', [['done_rate', 85, 12]])),
      health('land', 'red', 'Done in 40% of recent changes, 80% needed', [['done_rate', 40, 12]], null, null,
        prev('amber', [['done_rate', 52, 12]])),
      health('record', 'green', null, [['done_rate', 100, 12]], null, null, prev('green', [['done_rate', 100, 12]])),
    ],
    goal: { goalId: 'goal-1', measurableTotal: 8, measurableGreen: 3, instructed: 2, openItems: 5 },
    watched: true,
    tip: { branch: 'master', sha: 'a1b2c3d4e5f6', measuredSha: 'a1b2c3d4e5f6', commitsBehind: 0, measuredAt: at },
    ...overrides,
  });
}
