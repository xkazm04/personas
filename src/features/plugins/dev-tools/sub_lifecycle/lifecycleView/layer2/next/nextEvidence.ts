// What a step's own record says, for the Next panel (`nextModel`): the most
// common reason its changes skipped it, and how long it has been green - in
// Measures for a step the history tracks, in changes for an evidence step.
// Pure: no React, no i18n, no IO.
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { cellOf } from '../../history/historyModel';
import { clusterReasons } from '../../presets/evidence/reasons';

/**
 * The most common reason the changes that skipped or failed this step gave,
 * as written, and how many gave it: the top cluster of `clusterReasons` (the
 * one grouping, shared with the step screen's "Why it was skipped"). A tie
 * goes to the newer reason; no note at all is null with the count of misses.
 */
export function commonSkipReason(evidence: LifecycleEvidenceItem[], stepId: string): { reason: string | null; count: number } {
  const inputs = evidence.flatMap((item) => {
    const o = item.outcomes.find((x) => x.stepId === stepId);
    return o ? [{ outcome: o.outcome, detail: o.detail }] : [];
  });
  const { clusters, missed } = clusterReasons(inputs);
  const top = clusters[0];
  return top ? { reason: top.label, count: top.count } : { reason: null, count: missed };
}

/** How many Measures (newest back) a tracked step has been green; null when history does not track it. */
export function measureStreak(columns: LifecycleMeasureColumn[], stepId: string): number | null {
  let n = 0;
  let seen = false;
  for (let i = columns.length - 1; i >= 0; i--) {
    const cell = cellOf(columns[i]!, stepId);
    if (!cell) continue;
    seen = true;
    if (cell.health !== 'green') break;
    n += 1;
  }
  return seen ? n : null;
}

/** How many changes (newest first) were done for this step in a row. */
export function changeStreak(evidence: LifecycleEvidenceItem[], stepId: string): number {
  let n = 0;
  for (const item of evidence) {
    const o = item.outcomes.find((x) => x.stepId === stepId);
    if (!o || o.outcome === 'unknown') continue;
    if (o.outcome !== 'done') break;
    n += 1;
  }
  return n;
}
