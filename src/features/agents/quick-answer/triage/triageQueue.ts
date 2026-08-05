/**
 * triageQueue.ts — the queue's arithmetic, with no React in it.
 *
 * `useUnifiedTriage` owns the sources and the writes; this owns the projection
 * from "everything that exists" to "what the reviewer sees, and what the
 * counters say". It is split out because all three of the queue's honesty
 * properties are pure functions of that projection, and a pure function is the
 * only kind you can actually pin down in a test:
 *
 *  1. **A skip terminates.** A skipped item sorts behind everything undecided
 *     so it is seen again — but it is offered a bounded number of times
 *     ({@link MAX_SKIP_PASSES}) and then stands down for the session. Without a
 *     bound the deck can never reach its cleared state: skip the last card and
 *     it is instantly the last card again, forever.
 *  2. **Progress cannot exceed its total.** The denominator used to be
 *     `all.length`, which SHRINKS as polls drop resolved rows while the
 *     numerator only grows — "5 / 2" was reachable. Here the total is
 *     `decided + still-pending`, so the numerator is part of the denominator by
 *     construction.
 *  3. **The filter chips count what is left.** They used to tally the raw
 *     source list, so a kind you had already cleared kept advertising itself.
 *
 * React-free and store-free on purpose.
 */
import {
  compareOrder,
  countByKind,
  type TriageCounts,
  type TriageItem,
  type TriageKind,
} from './triageTypes';

/**
 * How many times one item may be skipped before it stops being re-presented
 * this session.
 *
 * Two, not one: the first skip is "not now, show me the rest", and re-offering
 * it after the queue drains is the whole point of skip-sorts-last. The second
 * skip is the reviewer saying it again with the same queue in front of them —
 * taking them at their word is what lets the deck finish.
 */
export const MAX_SKIP_PASSES = 2;

/** Times each item has been skipped this session, by item id. */
export type SkipLedger = ReadonlyMap<string, number>;

export interface QueueProjectionInput {
  /** Every item every source produced, before any session state is applied. */
  all: readonly TriageItem[];
  /** Ids this session has written a verdict for. */
  resolved: ReadonlySet<string>;
  skips: SkipLedger;
  activeKinds: ReadonlySet<TriageKind>;
  /**
   * The one item the reviewer JUMPED to from the queue rail, dealt next.
   *
   * A pin, not a re-sort: everything behind it keeps the order it already had,
   * so jumping ahead to the card you came here for does not reshuffle the queue
   * you were working through. It is session-local and writes nothing — the
   * projection drops it the moment that item is decided or filtered away.
   */
  focused?: string | null;
}

export interface QueueProjection {
  /** What the deck deals: active kinds only, undecided first, skipped last. */
  items: TriageItem[];
  /** Every kind still awaiting a decision, BEFORE the kind filter — the chips. */
  allCounts: TriageCounts;
  /** Decided + still-pending. Never less than `resolved.size`. */
  sessionTotal: number;
  /** Skipped to exhaustion this session: not decided, not offered again. */
  deferredCount: number;
}

/** How many times this item has been skipped this session. */
export function skipCount(skips: SkipLedger, id: string): number {
  return skips.get(id) ?? 0;
}

/** One more skip for `id`, as a new ledger. */
export function withSkip(skips: SkipLedger, id: string): Map<string, number> {
  const next = new Map(skips);
  next.set(id, skipCount(skips, id) + 1);
  return next;
}

/**
 * One FEWER skip for `id` — the undo of a deferral.
 *
 * A skip writes nothing, so taking one back is purely local and available on
 * every kind, including the four whose verdicts have no reverse door. It matters
 * most at the bound: the second skip is what stands a card down for the session
 * ({@link MAX_SKIP_PASSES}), so an accidental `S` on the card you meant to read
 * is otherwise unrecoverable until a reload.
 */
export function withoutSkip(skips: SkipLedger, id: string): Map<string, number> {
  const next = new Map(skips);
  const remaining = skipCount(skips, id) - 1;
  if (remaining > 0) next.set(id, remaining);
  else next.delete(id);
  return next;
}

export function projectQueue({
  all,
  resolved,
  skips,
  activeKinds,
  focused,
}: QueueProjectionInput): QueueProjection {
  const pending = all.filter((i) => !resolved.has(i.id));

  // Exhausted skips leave the deck but stay in the denominator: the reviewer
  // saw them and chose not to decide, which is not the same as never having
  // been asked.
  const live = pending.filter((i) => skipCount(skips, i.id) < MAX_SKIP_PASSES);

  // One pass that does three things the old code paid for inside the
  // comparator: applies the kind filter, LIFTS the pinned card out (a partition,
  // not a per-pair test — it was being re-checked against both operands of every
  // one of the O(n log n) comparisons for a property true of at most one row),
  // and reads each item's skip count ONCE instead of twice per comparison.
  //
  // The order is unchanged and still a consistent total order: the pin is a
  // single element prepended, and what follows is the same strict weak ordering
  // it always was.
  const rows: { item: TriageItem; skips: number }[] = [];
  let pinned: TriageItem | null = null;
  for (const item of live) {
    if (!activeKinds.has(item.kind)) continue;
    if (focused && item.id === focused) {
      pinned = item;
      continue;
    }
    rows.push({ item, skips: skipCount(skips, item.id) });
  }

  rows.sort(
    (a, b) =>
      a.skips - b.skips ||
      compareOrder(a.item.weight, a.item.createdAt, b.item.weight, b.item.createdAt),
  );

  const items = rows.map((r) => r.item);
  if (pinned) items.unshift(pinned);

  return {
    items,
    allCounts: countByKind(live),
    sessionTotal: resolved.size + pending.length,
    deferredCount: pending.length - live.length,
  };
}
