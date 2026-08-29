/**
 * DeckRailList — the scroller both rail tabs render into.
 *
 * The two tabs were two hand-copied lists: the same conditional virtualizer,
 * the same absolutely-positioned `<li>` arithmetic, the same plain-`<ul>`
 * fallback, written twice with two different row-height constants. That is the
 * shape that drifts — and drift here is invisible, because a virtualizer given
 * a wrong height still renders rows, just in the wrong places past the fortieth.
 *
 * So the shell is one component and the tabs supply only what actually differs:
 * the flattened items, how to draw one row, and (decide only) which row to keep
 * in view. Heights come from `railItemHeight`, never from the caller.
 *
 * NOT STICKY, deliberately. A project header that pins to the top of the
 * scroller is a real gain on a long list and cannot be had in the virtualized
 * path — rows there are absolutely positioned, so `position: sticky` has no
 * flow to stick within. Implementing it in the plain path only would give the
 * rail headers that stick at 40 rows and silently stop at 41, which is a worse
 * kind of wrong than not having them.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import {
  RAIL_VIRTUALIZE_ABOVE,
  railItemHeight,
  type RailListItem,
} from './deckRailGroups';

/**
 * The project header. `typo-label` is the app's "names a thing in less than a
 * line" tier — column headers, category markers, chip text — which is exactly
 * this, and it is one size below the `typo-body` rows so the header reads as
 * their parent rather than as a louder sibling.
 *
 * The count sits a tier below the name in a DIFFERENT TOKEN rather than at a
 * lower opacity: this app's contrast rule is that hierarchy comes from the type
 * scale, never from fading text out, and `custom/no-low-contrast-text-classes`
 * enforces it. `typo-code` is monospace 400 against the label's 600 — quieter by
 * weight, and it is already the token for a technical value.
 */
function RailGroupHeader({ label, count, first }: { label: string; count: number; first: boolean }) {
  return (
    <div
      data-rail-group
      style={{ height: railItemHeight({ kind: 'header', key: '', label, count, first }) }}
      className={`flex items-end gap-1.5 border-b border-primary/10 bg-secondary/25 px-3 pb-1 ${
        first ? '' : 'pt-2'
      }`}
    >
      <span data-rail-group-name className="typo-label truncate text-foreground">
        {label}
      </span>
      <span className="typo-code shrink-0 text-foreground">{count}</span>
    </div>
  );
}

export function DeckRailList<T>({
  flat,
  renderRow,
  listAttr,
  /** Flat index to keep in view as it changes — the decide list's cursor. Omit
   *  where the list has no read head, as the Accepted tab does not. */
  scrollTo,
}: {
  flat: RailListItem<T>[];
  renderRow: (item: T, index: number) => ReactNode;
  /** `data-*` hook the tests scope their row queries to. */
  listAttr: 'data-decide-list' | 'data-accepted-list';
  scrollTo?: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualize = flat.length > RAIL_VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    // Per-index, because headers and rows are different heights — and exact
    // rather than estimated, so nothing needs measuring.
    estimateSize: (i) => railItemHeight(flat[i]!),
    overscan: 5,
  });

  // A virtualized list only mounts the rows near the viewport, so a row-level
  // `scrollIntoView` cannot reach a current row that is not rendered. Drive the
  // scroller by index instead; the row's own effect still handles the short,
  // non-virtual list.
  useEffect(() => {
    if (!virtualize || scrollTo === undefined || scrollTo < 0) return;
    virtualizer.scrollToIndex(scrollTo, { align: 'auto' });
    // `virtualizer` re-identifies on every measure pass, and scrolling on that
    // would fight the reviewer's own scrolling. The cursor moving is the only
    // reason to move the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo, virtualize]);

  return (
    // The scroll element is handed to the virtualizer ONLY when the list is
    // long enough to virtualize. A virtualizer that owns a scroller it isn't
    // driving still measures and scrolls it.
    <div
      {...{ [listAttr]: '' }}
      ref={virtualize ? parentRef : undefined}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      {virtualize ? (
        <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const entry = flat[v.index]!;
            return (
              <li
                key={entry.key}
                className="absolute inset-x-0 top-0"
                style={{ height: v.size, transform: `translateY(${v.start}px)` }}
              >
                {entry.kind === 'header' ? (
                  <RailGroupHeader label={entry.label} count={entry.count} first={entry.first} />
                ) : (
                  renderRow(entry.item, entry.index)
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul>
          {flat.map((entry) => (
            <li key={entry.key}>
              {entry.kind === 'header' ? (
                <RailGroupHeader label={entry.label} count={entry.count} first={entry.first} />
              ) : (
                renderRow(entry.item, entry.index)
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
