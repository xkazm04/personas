/**
 * @catalog Virtualized list that buckets ordered items under sticky date/category group headers (Today / Yesterday / …).
 *
 * GroupedVirtualList — a virtualized scroll list whose items are bucketed into
 * groups (relative time or any category key) with a header that stays pinned to
 * the top of the viewport while its bucket scrolls. Built on TanStack Virtual so
 * it stays smooth at 1000+ rows; gives the same temporal/category wayfinding
 * Gmail and Linear use.
 *
 * The caller owns row rendering (via `renderItem`) and the grouping function
 * (via `groupOf`); the primitive owns the scroll container, the virtualizer, the
 * sticky-header mechanics, and optional scroll-position restoration. Pair the
 * `groupOf` with the {@link ./grouping} helpers (`timeGroupKey` +
 * `timeGroupLabels`) for the standard relative-time buckets.
 */
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual';
import { useScrollRestoration } from '@/hooks/utility/interaction/useScrollRestoration';
import { buildGroupRows, type GroupSpec } from './grouping';

/** Height of a sticky group header, in px (Tailwind `h-7`). */
export const GROUP_HEADER_SIZE = 28;

// ---------------------------------------------------------------------------
// useGroupedVirtualizer — shared virtualizer with a sticky active header.
//
// Exposed so other virtualized surfaces (e.g. the column-based UnifiedTable)
// can reuse the exact same grouping + sticky mechanics instead of duplicating
// the rangeExtractor logic.
// ---------------------------------------------------------------------------

export function useGroupedVirtualizer(params: {
  count: number;
  /** Flat indexes of header rows (from `buildGroupRows`). */
  headerIndexes: number[];
  getScrollElement: () => HTMLElement | null;
  /** Estimated height of a non-header item row, in px. */
  itemSize: number;
  headerSize?: number;
  overscan?: number;
}) {
  const { count, headerIndexes, getScrollElement, itemSize, headerSize = GROUP_HEADER_SIZE, overscan = 6 } = params;
  const headerSet = useMemo(() => new Set(headerIndexes), [headerIndexes]);

  // The header that should currently be pinned. A ref (not state) so updating it
  // inside rangeExtractor never triggers a render loop — the virtualizer already
  // re-renders on scroll, and the render reads `.current`.
  const activeStickyRef = useRef<number>(headerIndexes[0] ?? -1);

  const rangeExtractor = useCallback(
    (range: Range) => {
      // Nearest header at or above the top of the viewport becomes the pinned one.
      let sticky = headerIndexes.length ? (headerIndexes[0] as number) : -1;
      for (const h of headerIndexes) {
        if (h <= range.startIndex) sticky = h;
        else break;
      }
      activeStickyRef.current = sticky;
      const next = new Set(defaultRangeExtractor(range));
      if (sticky >= 0) next.add(sticky);
      return Array.from(next).sort((a, b) => a - b);
    },
    [headerIndexes],
  );

  const virtualizer = useVirtualizer({
    count,
    getScrollElement,
    estimateSize: (index) => (headerSet.has(index) ? headerSize : itemSize),
    overscan,
    rangeExtractor,
  });

  return { virtualizer, activeStickyRef, headerSet };
}

// ---------------------------------------------------------------------------
// Group header row
// ---------------------------------------------------------------------------

/**
 * The sticky group-header bar. Exported so column-based virtual lists (e.g.
 * UnifiedTable) can render the identical header markup instead of duplicating
 * the spec. `pinned` swaps it between `position: sticky` (pinned at the top of
 * the viewport) and `position: absolute` (scrolling at its bucket offset).
 */
export function GroupHeaderRow({
  label, count, pinned, start, height,
}: {
  label: string;
  count: number;
  pinned: boolean;
  start: number;
  height: number;
}) {
  return (
    <div
      className="flex items-center gap-2 px-4 z-10 bg-background/95 backdrop-blur-sm border-b border-primary/5"
      style={
        pinned
          ? { position: 'sticky', top: 0, left: 0, width: '100%', height }
          : { position: 'absolute', top: 0, left: 0, width: '100%', height, transform: `translateY(${start}px)` }
      }
    >
      <span className="typo-section-title text-foreground">{label}</span>
      <span className="typo-caption text-foreground tabular-nums">{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupedVirtualList
// ---------------------------------------------------------------------------

export interface GroupedVirtualListProps<T> {
  items: T[];
  /** Maps an item to its group key + label. Pair with the `grouping` helpers. */
  groupOf: (item: T, index: number) => GroupSpec;
  getItemKey: (item: T, index: number) => string;
  /** Render the inner row content. It should fill its row (`h-full`). */
  renderItem: (item: T, index: number) => ReactNode;
  /** Estimated row height, in px. */
  estimateItemSize: number;
  headerSize?: number;
  /** Classes for the scroll container (e.g. `flex-1`). */
  className?: string;
  /**
   * Remember/restore the scroll offset across remounts / route / tab switches
   * under this key. Omit to disable. See {@link useScrollRestoration}.
   */
  scrollRestoreKey?: string;
  /** Extra props merged onto the scroll container (role, tabIndex, aria-label, onKeyDown). */
  scrollContainerProps?: Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'ref'>;
}

export function GroupedVirtualList<T>({
  items,
  groupOf,
  getItemKey,
  renderItem,
  estimateItemSize,
  headerSize = GROUP_HEADER_SIZE,
  className,
  scrollRestoreKey,
  scrollContainerProps,
}: GroupedVirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const setScrollRef = useScrollRestoration(scrollRestoreKey, parentRef);

  const { rows, headerIndexes } = useMemo(() => buildGroupRows(items, groupOf), [items, groupOf]);

  const { virtualizer, activeStickyRef } = useGroupedVirtualizer({
    count: rows.length,
    headerIndexes,
    getScrollElement: () => parentRef.current,
    itemSize: estimateItemSize,
    headerSize,
  });

  return (
    <div ref={setScrollRef} className={`overflow-y-auto ${className ?? ''}`} {...scrollContainerProps}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const row = rows[vRow.index];
          if (!row) return null;
          if (row.kind === 'header') {
            return (
              <GroupHeaderRow
                key={`group-header:${vRow.index}:${row.key}`}
                label={row.label}
                count={row.count}
                pinned={activeStickyRef.current === vRow.index}
                start={vRow.start}
                height={headerSize}
              />
            );
          }
          return (
            <div
              key={getItemKey(row.item, row.dataIndex)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${estimateItemSize}px`,
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {renderItem(row.item, row.dataIndex)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
