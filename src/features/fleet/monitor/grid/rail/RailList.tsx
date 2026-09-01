// RailList — the one scroller all three tabs and all three variants share.
//
// It owns exactly two things the tabs kept getting wrong independently:
//
// 1. THE LIST CANNOT OVERFLOW THE UI. The rail is a fixed 320px column inside a
//    fixed-height Monitor; a 600-row feed rendered as 600 DOM nodes is what made
//    the old tabs push the card's height past the viewport. Rows are virtualized
//    above `VIRTUALIZE_ABOVE`, and the scroller is `min-h-0 flex-1 overflow-y-auto`
//    — the `min-h-0` being the part that actually stops a flex child from
//    refusing to shrink below its content.
//
// 2. INFINITE LOAD IS DRIVEN BY THE SCROLLER, NOT BY A BUTTON. `onEndReached`
//    fires once per arrival at the tail, from the SAME scroll position the
//    virtualizer is measuring, so paging and virtualization cannot disagree
//    about where the end is. It is guarded by `hasMore`, a distance threshold,
//    and an in-flight latch.
//
//    THE LATCH HAS A COOLDOWN, and that is a bug fix, not a refinement. It used
//    to clear only when `rows.length` CHANGED — so a page that returned nothing
//    (a slow query, a transient failure, a source that had not caught up yet)
//    left the latch armed against a row count that never moved again, and
//    paging was dead for the life of that list. Scrolling did nothing, forever,
//    silently. Now a request may be re-made once the rows grow OR once the
//    cooldown lapses, which keeps the anti-spam property while making a single
//    empty page recoverable instead of terminal.
//
// Row heights come from ONE function supplied by the caller (`heightOf`) and
// are applied to both the virtualizer and the row element from it — the
// arithmetic `DeckQueueRail` had to learn the hard way, where an `estimateSize`
// and a padding-implied height drifted and misplaced every row past the 40th.
// It was a constant until the Messages tab grew project bands; a function
// rather than a constant plus a special case, so there is still exactly one
// place that decides how tall a row is.

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from '@/i18n/useTranslation';
import type { RailRow } from './railModel';

/** Below this many rows, plain DOM reads better than a measure pass. */
const VIRTUALIZE_ABOVE = 30;
/** How close to the bottom counts as "arrived", in pixels. */
const END_THRESHOLD = 220;
/**
 * How long a request stays latched before another is allowed at the same row
 * count. Long enough that a page in flight is not asked for twice; short enough
 * that a page which came back empty is retried while the reader is still at the
 * bottom looking at it.
 */
const RETRY_AFTER_MS = 2_000;

export interface RailListProps {
  rows: RailRow[];
  /** Px height of one row — the single authority, see the header. Must be
   *  referentially stable, or the virtualizer re-measures on every render. */
  heightOf: (row: RailRow) => number;
  renderRow: (row: RailRow) => ReactNode;
  hasMore: boolean;
  loading: boolean;
  onEndReached: () => void;
  /** Rendered instead of the list when there is nothing AND nothing loading. */
  empty: ReactNode;
  testId?: string;
}

export function RailList({
  rows, heightOf, renderRow, hasMore, loading, onEndReached, empty, testId,
}: RailListProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  // Indexed, because that is the signature the virtualizer measures with. The
  // guard is for the frame where `count` has grown but this callback still
  // closes over the shorter array.
  const sizeOf = useCallback(
    (index: number) => {
      const row = rows[index];
      return row ? heightOf(row) : 0;
    },
    [rows, heightOf],
  );

  const virtualize = rows.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: sizeOf,
    overscan: 6,
  });

  // The in-flight latch: the row count we last asked at, and when. See the
  // header for why the timestamp is load-bearing rather than belt-and-braces.
  const asked = useRef<{ len: number; at: number }>({ len: -1, at: 0 });

  /** May we ask for another page right now? */
  const mayAsk = useCallback(() => {
    if (!hasMore) return false;
    const { len, at } = asked.current;
    return rows.length !== len || Date.now() - at > RETRY_AFTER_MS;
  }, [hasMore, rows.length]);

  const requestMore = useCallback(() => {
    asked.current = { len: rows.length, at: Date.now() };
    onEndReached();
  }, [onEndReached, rows.length]);

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || !mayAsk()) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > END_THRESHOLD) return;
    requestMore();
  }, [mayAsk, requestMore]);

  // A short feed can already BE at its end on first paint — a rail whose first
  // page does not fill the column would otherwise need a scroll gesture that is
  // impossible to make, and infinite load would never start.
  useEffect(() => {
    const el = parentRef.current;
    if (!el || !mayAsk()) return;
    if (el.scrollHeight > el.clientHeight + END_THRESHOLD) return;
    requestMore();
  }, [mayAsk, requestMore]);

  if (rows.length === 0) {
    // Nothing yet AND still reading is not "nothing waiting" — the empty state
    // asserts a fact the feed does not have until the first read lands (the
    // loading golden path's law 3). The chrome above stands alone instead.
    if (loading) return <div className="min-h-0 flex-1" />;
    return <div className="min-h-0 flex-1 overflow-y-auto">{empty}</div>;
  }

  return (
    <div
      ref={parentRef}
      onScroll={onScroll}
      data-testid={testId}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {virtualize ? (
        <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => (
            <li
              key={rows[v.index]!.id}
              className="absolute inset-x-0 top-0"
              style={{ height: v.size, transform: `translateY(${v.start}px)` }}
            >
              {renderRow(rows[v.index]!)}
            </li>
          ))}
        </ul>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id} style={{ height: heightOf(row) }}>
              {renderRow(row)}
            </li>
          ))}
        </ul>
      )}

      {/* The tail. It is INSIDE the scroller on purpose: a footer pinned outside
          would claim "loading more" while the reader is still at the top. */}
      {hasMore && (
        <p className="px-3 py-2 text-center typo-caption text-foreground opacity-50">
          {t.monitor.grid_rail_loading_more}
        </p>
      )}
    </div>
  );
}

export default RailList;
