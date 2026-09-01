// ColumnBody — one team column's scrolling roster, windowed above 30 rows.
//
// WHY THIS EXISTS: the rail virtualized and the board did not. `FleetGridView`
// mapped EVERY persona card and EVERY fleet session straight into live DOM, on
// a surface whose target is 100+ concurrent automations. Measured on the load
// harness between 60 and 100 nodes, p95 frame went 36.3 → 106.6ms and frames
// over 50ms went 2 → 163.
//
// GEOMETRY — and this is the decision worth reading. The board has two axes:
// columns scroll horizontally, tiles stack vertically inside a column. A single
// row-virtualizer does not fit that, so the choice was between windowing the
// COLUMNS (horizontal) and virtualizing WITHIN a column (vertical). This takes
// the vertical one, because that is the axis that is actually unbounded: the
// number of columns is the number of teams the operator has (small, and it does
// not grow with the fleet), while a single team's roster plus its live sessions
// is exactly what scales to hundreds.
//
// Taking the vertical axis has a consequence: each column now owns its own
// scroller instead of every column sharing the board's. That is deliberate and
// it is the reason this component is ~90 lines rather than a fragile 200. A
// virtualizer that owns its scroll element needs no `scrollMargin` arithmetic,
// no cross-column offset measurement, and cannot drift when a header's height
// changes — the same discipline `rail/RailList` runs on. It also means the
// column header is no longer `sticky` against a shared scroller but sits ABOVE
// the scroller permanently, which is the stronger form of the same property,
// and it fixes a real annoyance of the old geometry: scrolling to the bottom of
// a 200-deep column used to drag every short column off the screen with it.
// This is the standard two-axis board geometry (Trello, Jira) for the same
// reason.
//
// Below `VIRTUALIZE_ABOVE` rows the plain branch renders, and it renders the
// same DOM the board rendered before this change — a six-persona team is not
// asked to pay for a measure pass it cannot benefit from.

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { VIRTUALIZE_ABOVE, type ColumnRow } from './gridGeometry';

export interface ColumnBodyProps {
  rows: ColumnRow[];
  /** Paints one row. The row's HEIGHT is the caller's, not this function's. */
  renderRow: (row: ColumnRow) => ReactNode;
  /**
   * A row key to bring into view, or null. Only the column that HOLDS the key
   * acts; the others are handed the same value and correctly do nothing.
   *
   * A virtualized column cannot be scrolled to by the DOM, because the target
   * row is not in the DOM until it is scrolled to — the request has to reach
   * the virtualizer, which is why this is a prop rather than something the
   * caller could do with a ref from outside.
   */
  focusKey?: string | null;
}

export function ColumnBody({ rows, renderRow, focusKey }: ColumnBodyProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Heights are known constants per row kind (see gridGeometry), so the
  // virtualizer is handed exact sizes and never measures the DOM.
  const sizeOf = useCallback((i: number) => rows[i]?.height ?? 0, [rows]);

  const virtualize = rows.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: sizeOf,
    overscan: 6,
  });

  // Bring a focused row into view. Two paths, because the two branches below
  // render two different DOMs: a virtualized column has to ask the virtualizer
  // (its target row does not exist yet), a plain one can use the element.
  //
  // `virtualizer` re-identifies on every measure pass, so it is deliberately
  // NOT a dependency — scrolling on that would fight the operator's own
  // scrolling. The focus key changing is the only reason to move the viewport.
  useEffect(() => {
    if (!focusKey) return;
    const index = rows.findIndex((r) => r.key === focusKey);
    if (index < 0) return; // not this column's node
    if (virtualize) {
      virtualizer.scrollToIndex(index, { align: 'center' });
      return;
    }
    // jsdom has no layout, so `scrollIntoView` is not always defined.
    parentRef.current
      ?.querySelector(`[data-row-key="${CSS.escape(focusKey)}"]`)
      ?.scrollIntoView?.({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, rows, virtualize]);

  if (!virtualize) {
    return (
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {rows.map((row) => (
          <div key={row.key} data-row-key={row.key} style={{ height: row.height }}>
            {renderRow(row)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              data-row-key={row.key}
              className="absolute inset-x-0 top-0"
              style={{ height: v.size, transform: `translateY(${v.start}px)` }}
            >
              {renderRow(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ColumnBody;
