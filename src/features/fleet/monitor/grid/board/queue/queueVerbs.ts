// queueVerbs — the pure half of the queue's operator verbs.
//
// A board decides WHAT to send (`reorderPayload`, `canDrag`); the API layer
// (`@/api/fleet/queue`) sends it. Keeping the arithmetic here means a
// keyboard ↑/↓, a one-dimensional `Reorder` drop and the runway's wrapped
// two-dimensional drop all produce the same ordered id list from the same
// rule, and the tests drive the rule without a DOM.

import type { QueueItem } from './useQueueModel';

/** Only a queued row moves; a live row holds a slot and is not in the queue. */
export function canDrag(item: Pick<QueueItem, 'locked'>): boolean {
  return !item.locked;
}

/**
 * The full ordered id list after moving `fromId` to `toId`'s position, or
 * `null` when the move is a no-op (unknown ids, same id, a locked row). The
 * door takes the WHOLE order — rank is dense and 1-based on its side, so a
 * partial list would leave it guessing where the unlisted rows go.
 */
export function reorderPayload(
  items: readonly Pick<QueueItem, 'sessionId' | 'locked'>[],
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return null;
  const from = items.findIndex((i) => i.sessionId === fromId);
  const to = items.findIndex((i) => i.sessionId === toId);
  if (from < 0 || to < 0) return null;
  if (items[from]!.locked || items[to]!.locked) return null;
  const ids = items.map((i) => i.sessionId);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved!);
  return ids;
}

/**
 * Where a dragged row lands in a WRAPPED grid: the insertion index into
 * `items` (the dragged row still counted), before or after `targetId` by which
 * half of the target the pointer released on. `-1` for an unknown target. The
 * grid is two-dimensional and framer's `Reorder` is not, so the drop is
 * resolved from the target's identity and a side rather than from an axis.
 */
export function dropIndex(
  items: readonly Pick<QueueItem, 'sessionId'>[],
  targetId: string,
  before: boolean,
): number {
  const idx = items.findIndex((i) => i.sessionId === targetId);
  if (idx < 0) return -1;
  return before ? idx : idx + 1;
}

/**
 * The full ordered id list after dropping `fromId` before/after `targetId`,
 * or `null` when nothing moves (unknown ids, a locked row, or a drop onto its
 * own slot — the two insertion points that leave the order unchanged).
 */
export function dropPayload(
  items: readonly Pick<QueueItem, 'sessionId' | 'locked'>[],
  fromId: string,
  targetId: string,
  before: boolean,
): string[] | null {
  const from = items.findIndex((i) => i.sessionId === fromId);
  const at = dropIndex(items, targetId, before);
  if (from < 0 || at < 0) return null;
  if (items[from]!.locked || items.find((i) => i.sessionId === targetId)!.locked) return null;
  const ids = items.map((i) => i.sessionId);
  const [moved] = ids.splice(from, 1);
  // Removing the row shifts every later slot up by one.
  const insertAt = at > from ? at - 1 : at;
  if (insertAt === from) return null;
  ids.splice(insertAt, 0, moved!);
  return ids;
}

/** ↑ / ↓ as a payload: the id one step up or down, then `reorderPayload`. */
export function nudgePayload(
  items: readonly Pick<QueueItem, 'sessionId' | 'locked'>[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const idx = items.findIndex((i) => i.sessionId === id);
  if (idx < 0) return null;
  const target = items[idx + delta];
  if (!target) return null;
  return reorderPayload(items, id, target.sessionId);
}

/**
 * Apply an ordered id list to a queued list locally — the optimistic paint
 * between the drop and the snapshot that confirms it. Ranks are renumbered
 * densely from 1; a locked row is left where it was.
 */
export function applyOrder<T extends Pick<QueueItem, 'sessionId' | 'rank'>>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  const byId = new Map(items.map((i) => [i.sessionId, i]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of order) {
    const it = byId.get(id);
    if (it && !seen.has(id)) { out.push(it); seen.add(id); }
  }
  for (const it of items) if (!seen.has(it.sessionId)) out.push(it);
  return out.map((it, i) => ({ ...it, rank: i + 1 }));
}

/**
 * The door's per-rank wait, recovered from a snapshot's own numbers: it
 * estimates `now + rank × mean duration`, so any row carrying both a rank and
 * an estimate gives the mean back. Read it from the list BEFORE a local
 * reorder renumbers the ranks — afterwards the ranks are new and the
 * estimates are still the old ones, and the quotient means nothing. `null`
 * when no row has an estimate (no history to estimate from).
 */
export function meanWaitMs(
  items: readonly Pick<QueueItem, 'rank' | 'estimatedStartMs'>[],
  now: number,
): number | null {
  const sample = items.find((i) => i.rank !== null && i.rank > 0 && i.estimatedStartMs !== null);
  if (!sample) return null;
  return Math.max(0, (sample.estimatedStartMs! - now) / sample.rank!);
}

/**
 * Re-estimate starts after a local reorder, from the mean read before it.
 * With no mean every estimate is `null`, which the boards render as "no
 * estimate" rather than inventing one.
 */
export function reEstimate<T extends Pick<QueueItem, 'rank' | 'estimatedStartMs'>>(
  items: readonly T[],
  now: number,
  mean: number | null,
): T[] {
  return items.map((i) => ({
    ...i,
    estimatedStartMs: mean === null || i.rank === null ? null : Math.round(now + i.rank * mean),
  }));
}
