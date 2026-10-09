// Evidence histories for the evidence-step screens (Lifecycle excellence wave
// 8): a step detail's own changes, newest first, each reduced to that step's
// outcome (as `detail.rs` `project_step` ships them), and the snapshot window
// with every step's outcomes for the newest of them. Deterministic: the same
// index always gives the same change. Mirrored for the page harness by
// `scripts/style/page-harness/lifecycleEvidenceTapes.mjs`.
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import type { LifecycleSourceKind } from '@/lib/bindings/LifecycleSourceKind';
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';

import { healthyMix } from './fixtures';

export const NEWEST = Date.parse('2026-10-08T10:00:00Z');
const HOUR = 3_600_000;

export const LAND_NOTES = {
  pushed: (sha: string) => `Pushed straight to main at ${sha}`,
  local: 'Merged locally; the pull request was never opened',
  reviewer: 'No reviewer was available',
} as const;

export interface Change {
  kind: LifecycleSourceKind;
  outcome: LifecycleOutcome;
  detail: string | null;
}

function item(stepId: string, i: number, spacingH: number, c: Change): LifecycleEvidenceItem {
  const ref = c.kind === 'commit' ? `${(0x9f8e7d0 + i * 4099).toString(16)}aa${i}` : c.kind === 'pr' ? String(400 - i) : `task-${300 - i}`;
  return {
    sourceKind: c.kind,
    sourceRef: ref,
    title: `Change ${300 - i}`,
    occurredAt: new Date(NEWEST - i * spacingH * HOUR).toISOString(),
    outcomes: [{ stepId, outcome: c.outcome, detail: c.detail }],
  };
}

/** `count` changes of `stepId`, newest first, one every `spacingH` hours, each shaped by `shape(i)`. */
export function history(stepId: string, count: number, spacingH: number, shape: (i: number) => Change): LifecycleEvidenceItem[] {
  return Array.from({ length: count }, (_, i) => item(stepId, i, spacingH, shape(i)));
}

/**
 * Land below its target: commits skip it (pushed straight to main, or merged
 * locally), tasks keep it, pull requests always do; three skips left no note.
 * 60 changes, one a day: about nine weeks.
 */
export function landShape(i: number): Change {
  if (i % 10 === 4) return { kind: 'pr', outcome: 'done', detail: null };
  if (i % 3 === 0) return { kind: 'task', outcome: i % 18 === 0 ? 'skipped' : 'done', detail: i % 18 === 0 ? LAND_NOTES.reviewer : null };
  if (i % 7 === 1) return { kind: 'commit', outcome: 'done', detail: null };
  const sha = (0xabc1230 + i).toString(16);
  const detail = i % 13 === 2 ? null : i % 4 === 0 ? LAND_NOTES.local : LAND_NOTES.pushed(sha);
  return { kind: 'commit', outcome: i === 5 ? 'failed' : 'skipped', detail };
}

/** Commit healthy, with one dip week (days 14-20 back): 56 changes, one every 12 hours. */
export function commitShape(i: number): Change {
  const dip = i >= 28 && i < 42;
  const kind: LifecycleSourceKind = i % 4 === 0 ? 'task' : 'commit';
  if (dip && i % 2 === 0) return { kind, outcome: 'skipped', detail: 'Committed with --no-verify; the hook was skipped' };
  return { kind, outcome: i % 17 === 9 ? 'skipped' : 'done', detail: i % 17 === 9 ? 'Amended after the hook ran' : null };
}

export const landHistory = (count = 60) => history('land', count, 24, landShape);
export const commitHistory = (count = 56) => history('commit', count, 12, commitShape);

export function stepDetail(stepId: string, evidence: LifecycleEvidenceItem[]): LifecycleStepDetail {
  return { stepId, runs: [], docs: [], related: [], evidence };
}

/**
 * healthyMix whose evidence window is the newest `window` changes of `detail`,
 * each with EVERY step's outcome (this step's as in the detail, the rest done,
 * gate failed on the newest) - as the snapshot ships them.
 */
export function snapshotOver(detail: LifecycleEvidenceItem[], window = 20, overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
  return healthyMix({
    evidence: detail.slice(0, window).map((d, i) => ({
      ...d,
      outcomes: [
        { stepId: 'isolate', outcome: 'done' as const, detail: null },
        { stepId: 'gate', outcome: i === 0 ? 'failed' as const : 'done' as const, detail: i === 0 ? 'eslint failed on VaultPage.tsx' : null },
        ...d.outcomes,
        { stepId: 'record', outcome: 'done' as const, detail: null },
      ],
    })),
    ...overrides,
  });
}
