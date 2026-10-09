// What a step's own record says, for the Next panel (`nextModel`): the most
// common reason its changes skipped it, and how long it has been green - in
// Measures for a step the history tracks, in changes for an evidence step.
// Pure: no React, no i18n, no IO.
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { cellOf } from '../../history/historyModel';

/**
 * The most common note on the changes that skipped or failed this step, and
 * how many carried it. A tie goes to the newest note; no note at all is null.
 */
export function commonSkipReason(evidence: LifecycleEvidenceItem[], stepId: string): { reason: string | null; count: number } {
  const counts = new Map<string, number>();
  let missed = 0;
  for (const item of evidence) {
    const o = item.outcomes.find((x) => x.stepId === stepId);
    if (!o || (o.outcome !== 'skipped' && o.outcome !== 'failed')) continue;
    missed += 1;
    const note = o.detail?.trim();
    if (note) counts.set(note, (counts.get(note) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [note, n] of counts) if (best === null || n > counts.get(best)!) best = note;
  return { reason: best, count: best ? counts.get(best)! : missed };
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
