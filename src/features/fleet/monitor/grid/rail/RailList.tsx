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
//    about where the end is. It is guarded three ways: `hasMore`, an in-flight
//    latch that clears when the row count actually grows, and a distance
//    threshold — without the latch a slow page turns one arrival into a request
//    per scroll event.
//
// Rows are a CONSTANT height, supplied by the caller and applied to both the
// virtualizer and the row element from that one number — the arithmetic
// `DeckQueueRail` had to learn the hard way, where an `estimateSize` and a
// padding-implied height drifted and misplaced every row past the 40th.

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from '@/i18n/useTranslation';
import type { RailRow } from './railModel';

/** Below this many rows, plain DOM reads better than a measure pass. */
const VIRTUALIZE_ABOVE = 30;
/** How close to the bottom counts as "arrived", in pixels. */
const END_THRESHOLD = 220;

export interface RailListProps {
  rows: RailRow[];
  /** Fixed px height of every row. See the header. */
  rowHeight: number;
  renderRow: (row: RailRow) => ReactNode;
  hasMore: boolean;
  loading: boolean;
  onEndReached: () => void;
  /** Rendered instead of the list when there is nothing AND nothing loading. */
  empty: ReactNode;
  testId?: string;
}

export function RailList({
  rows, rowHeight, renderRow, hasMore, loading, onEndReached, empty, testId,
}: RailListProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const sizeOf = useCallback(() => rowHeight, [rowHeight]);

  const virtualize = rows.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: sizeOf,
    overscan: 6,
  });

  // The in-flight latch. `asked` holds the row count at which we last asked for
  // a page; a second request is refused until the count moves, so a page that
  // takes a second does not turn every scroll event into another call.
  const asked = useRef(-1);
  useEffect(() => {
    if (rows.length !== asked.current) asked.current = -1;
  }, [rows.length]);

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || !hasMore || asked.current !== -1) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > END_THRESHOLD) return;
    asked.current = rows.length;
    onEndReached();
  }, [hasMore, onEndReached, rows.length]);

  // A short feed can already BE at its end on first paint — a rail whose first
  // page does not fill the column would otherwise need a scroll gesture that is
  // impossible to make, and infinite load would never start.
  useEffect(() => {
    const el = parentRef.current;
    if (!el || !hasMore || asked.current !== -1) return;
    if (el.scrollHeight > el.clientHeight + END_THRESHOLD) return;
    asked.current = rows.length;
    onEndReached();
  }, [hasMore, onEndReached, rows.length]);

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
            <li key={row.id} style={{ height: rowHeight }}>
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
