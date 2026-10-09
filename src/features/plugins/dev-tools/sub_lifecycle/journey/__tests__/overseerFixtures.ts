// The Overseer's goal and Send preview fixtures (Lifecycle excellence wave 9),
// on `healthyMix()`. Mirrored for the page harness by the collar tape's GOAL
// and PREVIEW in `scripts/style/page-harness/lifecycleTapes.mjs`; keep the
// two in step.
//
// Every item state once: Gate reopened by a send (regressed) and Tests
// accepted - the two he still owes; Land closed by a Measure and red again
// since (the next send reopens it); Isolate and Record closed by Measure;
// Commit's item rejected (that decision stands). Sync has no item yet.
import type { LifecycleGoalItem } from '@/lib/bindings/LifecycleGoalItem';
import type { LifecycleGoalView } from '@/lib/bindings/LifecycleGoalView';
import type { LifecycleSendPreview } from '@/lib/bindings/LifecycleSendPreview';
import type { LifecycleSendPreviewStep } from '@/lib/bindings/LifecycleSendPreviewStep';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { healthyMix } from './fixtures';

const item = (
  id: string, stepId: string, title: string, status: string, verifyState: string | null, createdAt: string, updatedAt: string | null = null,
): LifecycleGoalItem => ({ id, stepId, title, status, verifyState, createdAt, updatedAt });

export function overseerGoal(overrides: Partial<LifecycleGoalView> = {}): LifecycleGoalView {
  return {
    goalId: 'goal-1', measurableTotal: 8, measurableGreen: 3, instructed: 2, openItems: 2,
    items: [
      item('idea-ov-gate', 'gate', 'Bring Gate back to green: eslint fails on VaultPage.tsx', 'accepted', 'regressed', '2026-10-07T03:30:00Z', '2026-10-08T07:30:00Z'),
      item('idea-ov-tests', 'tests', 'Turn lifecycle step `tests` green (measured amber)', 'accepted', null, '2026-10-07T07:30:00Z'),
      item('idea-ov-land', 'land', 'Turn lifecycle step `land` green (measured red)', 'delivered', 'cleared', '2026-10-07T03:30:00Z', '2026-10-07T11:30:00Z'),
      item('idea-ov-isolate', 'isolate', 'Turn lifecycle step `isolate` green (measured amber)', 'delivered', 'cleared', '2026-10-07T03:30:00Z', '2026-10-08T06:30:00Z'),
      item('idea-ov-record', 'record', 'Make lifecycle step `record` measurable', 'delivered', 'cleared', '2026-10-06T05:30:00Z', '2026-10-07T05:30:00Z'),
      item('idea-ov-commit', 'commit', 'Re-measure lifecycle step `commit` green on the base tip', 'rejected', null, '2026-10-06T05:30:00Z', '2026-10-06T17:30:00Z'),
    ],
    ...overrides,
  };
}

/** `healthyMix()` with the Overseer's goal holding every item state. */
export function withOverseerGoal(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
  return healthyMix({ goal: overseerGoal(), ...overrides });
}

const step = (stepId: string, health: LifecycleSendPreviewStep['health'], reason: string | null, itemId: string | null = null): LifecycleSendPreviewStep =>
  ({ stepId, health, reason, itemId });

/** What Send would do on `withOverseerGoal()`: every group present. */
export function sendPreview(overrides: Partial<LifecycleSendPreview> = {}): LifecycleSendPreview {
  return {
    goalId: 'goal-1',
    willFile: [step('sync', 'unmeasured', 'Only 3 changes recorded; 5 are needed')],
    alreadyOpen: [
      step('gate', 'amber', 'tsc 74s over 60s budget', 'idea-ov-gate'),
      step('tests', 'amber', 'Coverage 63% is under the 70% target', 'idea-ov-tests'),
    ],
    willReopen: [step('land', 'red', 'Done in 40% of recent changes, 80% needed', 'idea-ov-land')],
    skipped: [
      step('frame', 'instructed', null), step('recall', 'instructed', null),
      step('isolate', 'green', null), step('docs', 'green', null),
      step('commit', 'stale', 'its item was rejected; that decision stands', 'idea-ov-commit'),
      step('record', 'green', null),
    ],
    ...overrides,
  };
}
