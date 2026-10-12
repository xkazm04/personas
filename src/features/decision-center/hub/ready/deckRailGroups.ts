/**
 * deckRailGroups — the row geometry and the group flattening BOTH rail tabs share.
 *
 * The rail carries two lists that answer two different questions (`To decide`
 * is a ledger, `Accepted` is a selection) but they sit under one tab strip in
 * one column, so a reviewer switching tabs must not feel the ground move. Two
 * things make that true and both live here rather than in either component:
 *
 *  • ONE row height, ONE header height. They used to be two constants in two
 *    files (55 and 76) computed by hand from padding + line-height, which is
 *    exactly the arithmetic that drifts — and drift in a virtualizer's
 *    `estimateSize` misplaces every row past the fortieth, silently.
 *  • ONE grouping rule. Both lists mix every project's backlog, and the project
 *    used to ride on each row: an inline chip beside the decide title, a meta
 *    line under the accepted one. Per-row it is the most repeated token on
 *    screen and the least informative — thirty rows of "personas" — while the
 *    thing a reviewer actually wants (all of THIS project's work together) was
 *    not expressible at all. Hoisted to a header it is stated once, the rows
 *    get their full width back, and the grouping IS the answer.
 *
 * Pure — no React, no DOM. The index arithmetic below is the part that breaks
 * a virtualized list when it is wrong, so it is testable without rendering.
 */

/**
 * A row, in px. Fed to the virtualizer AND applied to the row itself, so the
 * two cannot disagree.
 *
 * 30 = one `typo-body` line box (14px × 1.65 ≈ 23.1, flex-centred) plus ~6 of
 * vertical padding plus the 1px hairline divider under every row.
 *
 * ONE line, not two. The two-line clamp the decide row used to carry existed
 * because the title was competing for width with a position badge on its left
 * and a project chip on its right; with both gone the title owns the whole rail
 * (18–36rem) and wraps far less often than it clamped. The full text still
 * rides in the row's tooltip.
 */
export const RAIL_ROW_HEIGHT = 30;

/**
 * A group header, in px — two heights, because the gap between groups is the
 * only thing separating them and a uniform header gives a long list no rhythm.
 *
 * 26 = one `typo-label` line box (12px × 1.4 ≈ 16.8) plus 8 of padding plus the
 * 1px rule under it. Every header after the first adds 8px of breathing room
 * above, paid as extra height rather than a margin: a virtualizer positions by
 * measured offset and a collapsing margin is not in that arithmetic.
 */
export const RAIL_GROUP_HEADER_HEIGHT = 26;
export const RAIL_GROUP_HEADER_HEIGHT_GAPPED = 34;

/** Above this many FLAT items (rows and headers alike) the list virtualizes.
 *  Below it, plain DOM reads better — a virtualizer with a handful of rows
 *  costs a measure pass and buys nothing. Shared, so the two tabs change
 *  behaviour at the same list length. */
export const RAIL_VIRTUALIZE_ABOVE = 40;

/** One windowed item: a project header, or one entry under it. */
export type RailListItem<T> =
  | {
      kind: 'header';
      key: string;
      /** The project's name, or the caller's fallback for "no project". */
      label: string;
      count: number;
      /** First header in the sequence — it gets no gap above. */
      first: boolean;
    }
  | {
      kind: 'row';
      key: string;
      item: T;
      /** Index in the ORIGINAL array. The decide list compares this against the
       *  queue cursor, which is an index into the ungrouped deal order — the
       *  one number grouping must not disturb. */
      index: number;
    };

/** The height a virtualizer must reserve for one flattened item. */
export function railItemHeight(item: RailListItem<unknown>): number {
  if (item.kind !== 'header') return RAIL_ROW_HEIGHT;
  return item.first ? RAIL_GROUP_HEADER_HEIGHT : RAIL_GROUP_HEADER_HEIGHT_GAPPED;
}

/**
 * Collapse a flat array into project groups, then back into ONE ordered
 * sequence a virtualizer can window.
 *
 * GROUP ORDER IS FIRST-APPEARANCE ORDER, and that is the whole reason grouping
 * is safe on the decide list. The queue is dealt by weight and the rail's job
 * is to answer "what is coming"; sorting groups alphabetically would put the
 * next card somewhere in the middle. Ordering them by where their first member
 * sits in the deal keeps the head of the queue at the top of the rail, and rows
 * inside a group keep their relative deal order too — so reading the rail top
 * to bottom still reads the queue, now with the project stated once per run.
 *
 * @param projectOf may return null/empty; those items collect under
 *        `fallbackLabel` as one group, in the position their first member had.
 */
export function groupRailRows<T>(
  items: T[],
  keyOf: (item: T) => string,
  projectOf: (item: T) => string | null | undefined,
  fallbackLabel: string,
): RailListItem<T>[] {
  // Insertion-ordered: a Map iterates in the order keys were first set, which
  // IS first-appearance order — no sort, and nothing to keep in sync with it.
  const groups = new Map<string, { label: string; rows: { item: T; index: number }[] }>();

  items.forEach((item, index) => {
    const raw = projectOf(item);
    const label = raw && raw.trim() ? raw : fallbackLabel;
    let group = groups.get(label);
    if (!group) {
      group = { label, rows: [] };
      groups.set(label, group);
    }
    group.rows.push({ item, index });
  });

  const flat: RailListItem<T>[] = [];
  let first = true;
  for (const group of groups.values()) {
    flat.push({
      // The label, not an ordinal: a header keyed by position re-keys every
      // group below one that empties out, remounting rows that did not change.
      key: `group:${group.label}`,
      kind: 'header',
      label: group.label,
      count: group.rows.length,
      first,
    });
    first = false;
    for (const { item, index } of group.rows) {
      flat.push({ kind: 'row', key: keyOf(item), item, index });
    }
  }
  return flat;
}

/**
 * Where the item at original index `index` landed in the flattened sequence,
 * or -1.
 *
 * The decide list scrolls its virtualizer by flat index while the deck moves a
 * cursor through the ungrouped deal — grouping puts headers between them, so
 * the two index spaces are no longer the same number and reusing one for the
 * other scrolls to the wrong row by however many headers precede it.
 */
export function flatIndexOf<T>(flat: RailListItem<T>[], index: number): number {
  return flat.findIndex((row) => row.kind === 'row' && row.index === index);
}
