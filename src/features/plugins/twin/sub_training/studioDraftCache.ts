/**
 * The Training Studio board, surviving the unmount the product tells the user
 * to cause.
 *
 * The studio advertises a walk-away background job: start a batch, leave, come
 * back. The board it returns to was `useState` inside `TrainingStudio`, so
 * flipping off the Setup stage or closing the studio dropped every row. A
 * remount could only recover the batch while `studioJustCompleted` was still
 * latched - and absorbing it CLEARS that latch, so once the board had been
 * populated and the studio closed, the questions were gone with nothing left to
 * re-absorb them from.
 *
 * `createModuleCache` rather than a hand-rolled `Map` because this is keyed by
 * twin, not a single slot: the repo's rule is that a multi-entry cache must
 * name its cap. `maxSize` is small on purpose - drafts for more than a handful
 * of twins in one session is not a workflow, it is a leak - and there is no
 * TTL, because the whole point is that a draft outlives the operator walking
 * away for an indeterminate time.
 *
 * The entry is dropped by the one event that means the rows are no longer a
 * draft: a successful save.
 */

import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';

export interface StudioDraftRow {
  id: string;
  question: string;
  answer: string;
  aiDrafted: boolean;
  include: boolean;
}

/** Twins whose in-progress board is kept. Small by design - see the header. */
export const STUDIO_DRAFT_MAX_TWINS = 5;

const cache = createModuleCache<string, StudioDraftRow[]>({
  maxSize: STUDIO_DRAFT_MAX_TWINS,
});

/** The board this twin left behind, or an empty one. Never another twin's. */
export function readStudioDraft(twinId: string | null): StudioDraftRow[] {
  if (!twinId) return [];
  return cache.get(twinId) ?? [];
}

/**
 * Keep this twin's board. An empty board is REMOVED rather than stored: an
 * entry meaning "nothing" would still occupy a slot and would read the same as
 * absent everywhere it is used.
 */
export function writeStudioDraft(twinId: string | null, rows: StudioDraftRow[]): void {
  if (!twinId) return;
  if (rows.length === 0) cache.delete(twinId);
  else cache.set(twinId, rows);
}

export function clearStudioDraft(twinId: string | null): void {
  if (!twinId) return;
  cache.delete(twinId);
}

/** Test hatch. */
export function resetStudioDrafts(): void {
  cache.clear();
}

export function studioDraftCount(): number {
  return cache.size;
}
