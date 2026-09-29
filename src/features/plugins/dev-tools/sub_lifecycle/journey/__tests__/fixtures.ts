// Snapshot builders for the journey tests. Shapes follow the WP1 bindings;
// the Solo step list mirrors src-tauri/src/lifecycle/presets.rs.
import type { LifecycleBindingKind } from '@/lib/bindings/LifecycleBindingKind';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecyclePhase } from '@/lib/bindings/LifecyclePhase';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import type { LifecycleStepView } from '@/lib/bindings/LifecycleStepView';

const PARAMS = {
  lint: null, codeQuality: null, docsRequired: null, landMode: null,
  prBase: null, automergeEnabled: null, automergeTarget: null,
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

/** Solo v0 as the backend reports it for a repo with nothing installed. */
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
