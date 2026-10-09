// One step's evidence, the rows every evidence section draws: the step
// detail's own history (up to 200 changes this step recorded, each with every
// step's outcome) joined with the snapshot's newest window, deduplicated by
// change and ordered newest first. The snapshot's rows are on
// screen before the detail read answers, so a slow read never hides them; the
// detail then adds the older changes. Pure: no React, no i18n, no IO.
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { evidenceRowsFor, type EvidenceRow } from '../../blocks/evidenceRows';

export const OUTCOME_ORDER: readonly LifecycleOutcome[] = ['done', 'skipped', 'failed', 'unknown'];

export type OutcomeCounts = Record<LifecycleOutcome, number>;

/** The change's key, the same one `evidenceRowsFor` gives a row. */
export function changeKey(item: Pick<LifecycleEvidenceItem, 'sourceKind' | 'sourceRef'>): string {
  return `${item.sourceKind}:${item.sourceRef}`;
}

function timeOf(item: LifecycleEvidenceItem): number {
  const ms = Date.parse(item.occurredAt);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * This step's rows: every change of `detail` and every change of `snapshot`
 * that carries an outcome for the step, once each (the detail's copy wins),
 * newest first.
 */
export function stepEvidenceRows(stepId: string, detail: readonly LifecycleEvidenceItem[], snapshot: readonly LifecycleEvidenceItem[]): EvidenceRow[] {
  const byKey = new Map<string, LifecycleEvidenceItem>();
  for (const item of snapshot) if (item.outcomes.some((o) => o.stepId === stepId)) byKey.set(changeKey(item), item);
  for (const item of detail) if (item.outcomes.some((o) => o.stepId === stepId)) byKey.set(changeKey(item), item);
  const items = [...byKey.values()].sort((a, b) => timeOf(b) - timeOf(a));
  return evidenceRowsFor(stepId, items);
}

export function outcomeCounts(rows: readonly Pick<EvidenceRow, 'outcome'>[]): OutcomeCounts {
  const c: OutcomeCounts = { done: 0, skipped: 0, failed: 0, unknown: 0 };
  for (const r of rows) c[r.outcome] += 1;
  return c;
}

