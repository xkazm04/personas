import type { ConversationRow } from './conversationModel';

/* ── ROW IDENTITY ──────────────────────────────────────────────────────────── */

/**
 * Are these two rows the same row, carrying the same content?
 *
 * Item identity is compared by REFERENCE, not by field: the channel slice
 * preserves `TeamChannelItem` identity across a quiet refresh (C1), so a poll
 * that changed nothing hands back the very same objects. That makes `===` the
 * honest test — a deep compare would cost more than the re-render it saves.
 */
function sameRow(a: ConversationRow, b: ConversationRow): boolean {
  if (a.kind !== b.kind || a.key !== b.key) return false;
  switch (a.kind) {
    case 'day':
      return a.at === (b as typeof a).at;
    case 'talk':
      return a.at === (b as typeof a).at && a.item === (b as typeof a).item;
    case 'assignment':
    case 'deliberation': {
      const o = b as typeof a;
      if (a.at !== o.at || a.items.length !== o.items.length) return false;
      for (let i = 0; i < a.items.length; i++) if (a.items[i] !== o.items[i]) return false;
      return true;
    }
    case 'proposal':
      // `at` is deliberately NOT compared: a proposal is local-only and its
      // timestamp is minted at build time, so comparing it would make every
      // rebuild a change. The proposal object is the identity.
      return a.proposal === (b as typeof a).proposal;
    case 'queued':
      return a.prompt === (b as typeof a).prompt;
  }
}

/**
 * Carry unchanged rows across a rebuild.
 *
 * `buildConversation` is pure and allocates a fresh object per row, so one
 * arriving message used to hand every memoized card a brand-new `row` prop and
 * a brand-new `items` array — the virtualizer's `getItemKey` saved the DOM
 * nodes and nothing saved the renders. This re-keys the newly built list
 * against the previous one and returns the PREVIOUS object wherever the content
 * is identical, so `React.memo` on the cards finally has something to bail on.
 *
 * When nothing at all changed it returns the previous ARRAY, so the consumer's
 * own `useMemo` result keeps identity too.
 */
export function reconcileRows(
  prev: readonly ConversationRow[],
  next: ConversationRow[],
): ConversationRow[] {
  if (prev.length === 0) return next;
  const byKey = new Map<string, ConversationRow>();
  for (const row of prev) byKey.set(row.key, row);

  let reusedAll = prev.length === next.length;
  for (let i = 0; i < next.length; i++) {
    const fresh = next[i]!;
    const old = byKey.get(fresh.key);
    if (old && sameRow(old, fresh)) {
      next[i] = old;
      if (reusedAll && prev[i] !== old) reusedAll = false;
    } else {
      reusedAll = false;
    }
  }
  return reusedAll ? (prev as ConversationRow[]) : next;
}
