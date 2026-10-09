// What "Send to Overseer" will do, as the groups the confirm reads out, from
// the backend's dry run (`previewLifecycleSend`, built by the same decision
// function the send applies). Pure: no React, no i18n.
//
// The backend's `skipped` list holds two different things: steps with nothing
// to do (green, or followed by instruction; no item) and not-green steps whose
// item someone decided (rejected, archived, expired; `itemId` set). The first
// is one quiet count; the second is named, because "Docs is left alone" is a
// decision the reader may want to revisit. The decided item's status is read
// from the goal's own items by id, never from the backend's English reason.
import type { LifecycleGoalView } from '@/lib/bindings/LifecycleGoalView';
import type { LifecycleSendPreview } from '@/lib/bindings/LifecycleSendPreview';
import type { LifecycleSendPreviewStep } from '@/lib/bindings/LifecycleSendPreviewStep';

export type PreviewGroupKind = 'file' | 'reopen' | 'open' | 'decided';

export interface PreviewRow extends LifecycleSendPreviewStep {
  /** For a decided step: its item's status, when the goal lists the item. */
  itemStatus: string | null;
}

export interface PreviewGroup {
  kind: PreviewGroupKind;
  rows: PreviewRow[];
}

export interface PreviewPlan {
  /** True when send opens a new goal (none is open). */
  newGoal: boolean;
  /** The non-empty groups, in the order they are read: what changes first. */
  groups: PreviewGroup[];
  /** Steps send has nothing to do for (green or instructed). */
  healthy: number;
  /** Nothing will be filed or reopened: sending only keeps the watch. */
  nothingNew: boolean;
}

export function previewPlan(preview: LifecycleSendPreview, goal: LifecycleGoalView | null): PreviewPlan {
  const status = (id: string | null) => (id && goal?.items.find((i) => i.id === id)?.status) || null;
  const row = (s: LifecycleSendPreviewStep): PreviewRow => ({ ...s, itemStatus: null });
  const decided = preview.skipped.filter((s) => s.itemId !== null);
  const all: PreviewGroup[] = [
    { kind: 'file', rows: preview.willFile.map(row) },
    { kind: 'reopen', rows: preview.willReopen.map(row) },
    { kind: 'open', rows: preview.alreadyOpen.map(row) },
    { kind: 'decided', rows: decided.map((s) => ({ ...s, itemStatus: status(s.itemId) })) },
  ];
  return {
    newGoal: preview.goalId === null,
    groups: all.filter((g) => g.rows.length > 0),
    healthy: preview.skipped.length - decided.length,
    nothingNew: preview.willFile.length === 0 && preview.willReopen.length === 0,
  };
}
