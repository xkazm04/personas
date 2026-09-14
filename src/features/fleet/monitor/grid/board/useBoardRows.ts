// useBoardRows — where the board wraps, and how wide it is when it decides.
//
// The board ran as ONE unbounded row of columns scrolling sideways, which put
// the twentieth project several screens right of the first and made "how is the
// fleet doing" a question you answered by dragging. Columns now run five to a
// row and the fleet grows downward — the axis a display has more of and a
// scroll wheel is already on. `gridGeometry`'s "board's own wrap" carries the
// two costs that bought.
//
// THE STATE IS THE COUNT, NOT THE WIDTH, and that is the difference between a
// rail drag costing nothing and costing a re-render of every column on every
// observer tick: setting the same count is a React bail-out, so the board only
// re-renders on the few pixels that actually cross a wrap threshold.

import { useEffect, useMemo, useRef, useState } from 'react';
import { boardPerRow, chunkRows, COLUMNS_PER_ROW } from '../gridGeometry';
import type { BoardColumn } from '../useBoardModel';

/** The scroller's own `p-3`, which is not available to columns. */
const BOARD_PADDING = 24;

export interface BoardRows {
  /** Attach to the scroller — it is the element whose width decides the wrap. */
  boardRef: React.RefObject<HTMLDivElement | null>;
  rows: BoardColumn[][];
}

export function useBoardRows(columns: BoardColumn[], mounted: boolean): BoardRows {
  const boardRef = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(COLUMNS_PER_ROW);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => setPerRow(boardPerRow(el.clientWidth - BOARD_PADDING));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `mounted` is the board's own presence: the scroller does not exist while
    // the empty state or the cold ghost is rendered in its place, so the effect
    // has to re-run when it appears rather than measuring a null ref once.
  }, [mounted]);

  const rows = useMemo(() => chunkRows(columns, perRow), [columns, perRow]);
  return { boardRef, rows };
}
