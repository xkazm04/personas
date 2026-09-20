// useBoardRows — where the board wraps, and how wide it is when it decides.
//
// The board ran as ONE unbounded row of columns scrolling sideways, which put
// the twentieth project several screens right of the first and made "how is the
// fleet doing" a question you answered by dragging. Columns now run five to a
// row and the fleet grows downward — the axis a display has more of and a
// scroll wheel is already on. `gridGeometry`'s "board's own wrap" carries the
// two costs that bought.
//
// THE STATE IS SCALARS, NEVER THE RAW WIDTH, and that is the difference between
// a rail drag costing nothing and costing a re-render of every column on every
// observer tick: setting the same number is a React bail-out, so the board only
// re-renders on the pixels that actually cross a threshold. The classic board
// now also spreads its columns (`boardLayout`), so it has a second such number
// — kept as its own scalar rather than folded into an object, because a fresh
// object every observer tick is a re-render every observer tick by definition.

import { useEffect, useMemo, useRef, useState } from 'react';
import { boardPerRow, chunkRows, COLUMNS_PER_ROW, TILE_W, type BoardLayout } from '../gridGeometry';

/** The scroller's own `p-3`, which is not available to columns. */
const BOARD_PADDING = 24;

export interface BoardRows<T> {
  /** Attach to the scroller — it is the element whose width decides the wrap. */
  boardRef: React.RefObject<HTMLDivElement | null>;
  rows: T[][];
  perRow: number;
  /**
   * How wide one column is. Without a `layout` this is `tileWidth` and never
   * changes — a caller that wants a count only gets exactly the state it had
   * before the ladder existed, and none of its re-renders.
   */
  columnWidth: number;
}

/**
 * Generic over the item: team columns for the classic board, queued nodes for
 * the runway's wrapped queue. `tileWidth` / `maxPerRow` let the runway measure
 * with no five-column ceiling while sharing the one ResizeObserver discipline,
 * and they are also the PRE-MEASUREMENT state — what the board assumes until
 * the scroller exists.
 *
 * `layout` opts into a measured width as well as a count (the classic board
 * passes `boardLayout`). It is a module function, not a closure, so it is
 * stable across renders and does not re-arm the observer.
 */
export function useBoardRows<T>(
  columns: readonly T[],
  mounted: boolean,
  tileWidth = TILE_W,
  maxPerRow = COLUMNS_PER_ROW,
  layout?: (width: number) => BoardLayout,
): BoardRows<T> {
  const boardRef = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(maxPerRow);
  const [columnWidth, setColumnWidth] = useState(tileWidth);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth - BOARD_PADDING;
      if (!layout) {
        setPerRow(boardPerRow(width, tileWidth, maxPerRow));
        return;
      }
      // Two setStates, both scalars: React batches them into one render, and
      // each bails out on its own when the measurement did not move it.
      const next = layout(width);
      setPerRow(next.perRow);
      setColumnWidth(next.columnWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `mounted` is the board's own presence: the scroller does not exist while
    // the empty state or the cold ghost is rendered in its place, so the effect
    // has to re-run when it appears rather than measuring a null ref once.
  }, [mounted, tileWidth, maxPerRow, layout]);

  const rows = useMemo(() => chunkRows(columns, perRow), [columns, perRow]);
  return { boardRef, rows, perRow, columnWidth };
}
