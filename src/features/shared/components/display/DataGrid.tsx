/**
 * @catalog Paginated table — page-size selector, row selection + bulk-action toolbar, row drag; caller-owned sort. Else use UnifiedTable.
 *
 * One of the three shared table primitives (see the tables golden path,
 * `docs/concepts/golden-paths/tables.md`). Reach for `DataGrid` **only** when
 * you need page-based pagination, checkbox row selection with a floating
 * bulk-action toolbar, or HTML5 row drag — `UnifiedTable` has none of those.
 * Everything else belongs on `UnifiedTable`, which in turn has what this one
 * lacks: virtualization, `groupBy`, column resize, sort persistence, keyboard
 * row nav, scroll restoration and infinite scroll. Slash-path taxonomies go to
 * `FacetedDecisionTable`, which wraps this component.
 *
 * **Sorting is caller-owned here** — pass `sortKey` + `sortDirection` + `onSort`
 * (unlike `UnifiedTable`, which sorts internally).
 *
 * Cold load is handled for you: pass the real in-flight `isLoading` flag and
 * the grid renders the calm delayed ghost rows under its permanent column
 * header, then ripples rows in via the shared id-guarded entrance. Don't build
 * a skeleton, an empty state, a pagination bar or a row cascade around it.
 */
import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, X } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { TruncateWithTooltip } from './TruncateWithTooltip';
import { DataGridPager } from './DataGridPager';
import { SortableHeader } from '@/features/shared/components/display/SortableHeader';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useRowRevealEntrance } from './UnifiedTable';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import { DEFAULT_DENSITY, DENSITY_TOKENS, type Density } from '@/lib/density';

/* -- Types ----------------------------------------------------------- */

export interface DataGridColumn<T> {
  key: string;
  label: string;
  /** CSS grid fraction, e.g. "1fr", "0.8fr", "120px" */
  width: string;
  /** If provided, renders a ThemedSelect filter in the header */
  filterOptions?: { value: string; label: string }[];
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  /** Custom filter component rendered instead of ThemedSelect */
  filterComponent?: React.ReactNode;
  /** If true, column header is clickable to toggle sort */
  sortable?: boolean;
  /** Align content: 'left' (default) | 'right' | 'center' */
  align?: 'left' | 'right' | 'center';
  /**
   * Keep the cell on one line. For a time, a figure or a short code: "8 min ago"
   * broken over two lines reads as two values. Opt-in per column, because a
   * wrapping text column is sometimes what a caller wants.
   */
  nowrap?: boolean;
  /** Custom cell renderer. If not provided, displays `row[key]` as string */
  render: (row: T, index: number) => React.ReactNode;
}

export interface DataGridProps<T> {
  columns: DataGridColumn<T>[];
  data: T[];
  /** Unique key extractor per row */
  getRowKey: (row: T) => string;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Optional left border accent color per row - return a Tailwind hover class like 'hover:border-l-emerald-400' */
  getRowAccent?: (row: T) => string;
  /** Sort state */
  sortKey?: string | null;
  sortDirection?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  /** Page size. 0 = no pagination */
  pageSize?: number;
  /** Available page size options for the selector. Defaults to [10, 25, 50, 100]. */
  pageSizeOptions?: number[];
  /** Callback when user changes page size via the selector */
  onPageSizeChange?: (size: number) => void;
  /**
   * In-flight fetch flag. Drives the calm delayed ghost rows, which render only
   * while `isLoading && data.length === 0` — so a refetch with rows on screen
   * changes nothing, and the empty state is unreachable until the fetch settles.
   */
  isLoading?: boolean;
  /**
   * Already-translated failure message for the last fetch. Without it a failed
   * first fetch renders `emptyTitle` — the empty-as-failure lie. Failed-and-
   * empty paints the panel-variant `ErrorBanner` under the permanent column
   * header; failed-WITH-rows keeps the rows and adds an inline banner above
   * them. Leave undefined/null when the last fetch succeeded.
   */
  error?: string | null;
  /** Retry handler surfaced on the failure banner. Omit for a message-only banner. */
  onRetry?: () => void;
  /**
   * Already-translated screen-reader announcement for the loading state.
   * Defaults to the generic translated `shared.grid_loading`.
   */
  loadingLabel?: string;
  /** Empty state */
  emptyIcon?: React.ComponentType<{ className?: string }>;
  /**
   * **Always pass an already-translated, surface-specific title** ("No
   * credentials yet", not "No data") — omitting it falls back to the generic
   * translated `shared.grid_no_data`, which is a last resort, not a default
   * worth shipping.
   */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Optional per-row className (e.g. highlight animations) */
  getRowClassName?: (row: T) => string;
  /**
   * Optional per-row HTML-attribute hook. Returned props are spread onto the
   * row's outer element — useful for drag sources (`draggable` + `onDragStart`),
   * drag-over highlighting, or context-menu wiring. Keep returned objects
   * referentially stable across renders or React will re-spread on every tick.
   */
  getRowProps?: (row: T) => React.HTMLAttributes<HTMLDivElement> | undefined;
  /**
   * Key of the row currently being dragged (when the consumer wires HTML5 drag
   * via `getRowProps`). Drives the drag-affordance treatment: the dragged row
   * lifts (`scale-[0.98]` + `shadow-elevation-3`) and every sibling dims to
   * `opacity-70` so the operation reads clearly. Leave undefined when not
   * dragging.
   */
  draggingRowKey?: string | null;
  /** Optional className for the outer container */
  className?: string;
  /**
   * How tall the grid is. `'fill'` (default, the historic behaviour): the body
   * takes the height the caller gives it, so the pager sits at the bottom of that
   * box. `'content'`: the body is as tall as its rows, capped by the height
   * available (it scrolls only past that), and the pager sits right under the
   * last row. `'page'`: the body is as tall as ALL its rows, uncapped, so the
   * page around the grid scrolls instead of the grid (one surface, one
   * scrollbar); the header stays sticky against that page scroller and the
   * bulk toolbar sticks to its bottom edge. With `'content'` or `'page'` the
   * caller must not force the grid's height (no `flex-1`/`h-full` in
   * `className`), and with `'page'` no ancestor between the grid and the page
   * scroller may clip overflow, or the sticky header has nothing to stick to.
   */
  fit?: 'fill' | 'content' | 'page';
  /** When true, hides column filters and reduces page size to 5. */
  simplified?: boolean;
  /** Whether all rows are selected (renders a header checkbox for the first column) */
  selectAll?: boolean;
  /** Toggle select-all callback */
  onSelectAll?: () => void;
  /** Whether a given row is selected — drives data-selected attribute, row tint, and accent border. */
  isRowSelected?: (row: T) => boolean;
  /** Row density. Defaults to 'comfortable'. */
  density?: Density;
  /** Number of currently selected rows. When > 0 and `bulkActions` is provided, the bulk-action toolbar slides up. */
  selectedCount?: number;
  /** Per-grid registry of bulk actions shown in the floating toolbar. */
  bulkActions?: DataGridBulkAction[];
  /** Called when the user clears the selection (X button or Esc). */
  onClearSelection?: () => void;
}

/** Bulk-action descriptor used by the floating toolbar that appears when rows are selected. */
export interface DataGridBulkAction {
  id: string;
  /** Already-translated label. */
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  /** 'danger' tints the button red. Defaults to 'default' (ghost). */
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

/** Shared ease for the bulk-toolbar slide (rows use the CSS entrance now). */
const EASE_CURVE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/* -- Component ------------------------------------------------------- */

export function DataGrid<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  getRowAccent,
  sortKey,
  sortDirection = 'desc',
  onSort,
  pageSize = 0,
  pageSizeOptions = [10, 25, 50, 100],
  onPageSizeChange,
  isLoading = false,
  error,
  onRetry,
  loadingLabel,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyDescription,
  getRowClassName,
  getRowProps,
  draggingRowKey,
  className,
  fit = 'fill',
  simplified = false,
  selectAll,
  onSelectAll,
  isRowSelected,
  density = DEFAULT_DENSITY,
  selectedCount = 0,
  bulkActions,
  onClearSelection,
}: DataGridProps<T>) {
  const densityTokens = DENSITY_TOKENS[density];
  // Headers share the rows' horizontal padding so every column label sits on
  // the same x-axis as its cell content. The old fixed `px-4` drifted 4px off
  // the `px-3` compact rows and left the 40px select column only 8px of inner
  // width — enough to visibly squash the select-all checkbox against the row
  // checkboxes below it.
  const headerPadCls = `${densityTokens.rowPaddingX} ${densityTokens.headerPaddingY}`;
  const rowPadCls = `${densityTokens.rowPaddingX} ${densityTokens.rowPaddingY}`;
  const { t, tx } = useTranslation();
  const [page, setPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(
    simplified && pageSize === 0 ? 5 : pageSize,
  );

  // Sync internal page size when the prop changes
  useEffect(() => {
    setInternalPageSize(simplified && pageSize === 0 ? 5 : pageSize);
  }, [pageSize, simplified]);

  const effectivePageSize = internalPageSize;

  // Clamp (don't reset) the page when the row count changes. A plain reset to
  // page 1 on every `data.length` change conflates routine add/remove (e.g.
  // deleting a single row on page 4) with an actual filter change, which
  // snapped the user back to page 1 after ordinary edits. Clamping only moves
  // the page back when it's no longer in range.
  useEffect(() => {
    setPage((p) => {
      if (effectivePageSize <= 0) return 1;
      const newTotalPages = Math.max(1, Math.ceil(data.length / effectivePageSize));
      return Math.min(p, newTotalPages);
    });
  }, [data.length, effectivePageSize]);

  // Esc clears the active selection — only attached while the toolbar is visible.
  const showBulkToolbar = selectedCount > 0 && !!bulkActions && bulkActions.length > 0;
  useEffect(() => {
    if (!showBulkToolbar || !onClearSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showBulkToolbar, onClearSelection]);

  const gridTemplate = columns.map((c) => c.width).join(' ');

  const totalPages = effectivePageSize > 0 ? Math.max(1, Math.ceil(data.length / effectivePageSize)) : 1;
  const pageData = useMemo(() => {
    if (effectivePageSize <= 0) return data;
    const start = (page - 1) * effectivePageSize;
    return data.slice(start, start + effectivePageSize);
  }, [data, page, effectivePageSize]);

  // One-shot id-guarded row entrance (shared with UnifiedTable): a new page's
  // rows ripple on their FIRST appearance; returning to a page, polling, or a
  // background refetch re-delivering the same keys renders plainly. Replaces
  // the old framer per-page stagger, which replayed the entrance for every row
  // on every pagination click (banned by loading pattern v2, law 4).
  const rowEntrance = useRowRevealEntrance({});
  // Still drives the bulk-toolbar slide-up (reduced-motion aware).
  const { shouldAnimate } = useMotion();

  const Icon = EmptyIcon || Inbox;

  /* -- Grid --------------------------------------------------------- */
  return (
    <div className={`relative flex flex-col min-h-0 ${className ?? ''}`}>
      {/* Header — always visible so filter controls remain accessible */}
      <div
        // The transparent 2px left border mirrors the rows' accent gutter, so
        // header labels sit exactly above their cell content instead of 2px to
        // the left of it.
        className="grid gap-0 border-b border-primary/10 border-l-2 border-l-transparent bg-background sticky top-0 z-20"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((col) => {
          /* Select-all checkbox header */
          if (col.key === 'select' && onSelectAll) {
            return (
              <div key={col.key} className={`${headerPadCls} flex items-center justify-center`}>
                {/* Geometry and treatment mirror the per-row select cell so the
                    header box reads as the same control, not a clipped one. */}
                <div
                  onClick={onSelectAll}
                  className={`w-4 h-4 shrink-0 rounded border transition-all flex items-center justify-center cursor-pointer ${
                    selectAll
                      ? 'bg-primary/80 border-primary/60'
                      : 'border-primary/25 hover:border-primary/50'
                  }`}
                >
                  {selectAll && (
                    <svg className="w-3 h-3 text-foreground" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
            );
          }

          /* Custom filter component takes precedence */
          if (!simplified && col.filterComponent) {
            return (
              <div key={col.key} className={`${headerPadCls} flex items-center min-w-0 whitespace-nowrap`}>
                {col.filterComponent}
              </div>
            );
          }

          /* Filterable header (hidden in simplified mode) */
          if (!simplified && col.filterOptions && col.onFilterChange) {
            return (
              <div key={col.key} className={`${headerPadCls} flex items-center min-w-0`}>
                <ThemedSelect
                  filterable
                  options={col.filterOptions}
                  value={col.filterValue ?? ''}
                  onValueChange={col.onFilterChange}
                  placeholder={col.label}
                  // -mx-2 cancels the select's own !px-2 so its label starts on
                  // the same x as a plain/sortable header, while the hover
                  // background still bleeds into the cell padding.
                  // Headers never wrap. The select fills its cell (it used to shrink to
                  // its text, which put the chevron on top of the label), keeps room
                  // for the chevron, and ellipsizes its label; the open list carries
                  // every option in full.
                  wrapperClassName="flex-1 min-w-0"
                  className="!pl-2 !pr-7 !py-0 -mx-2 !rounded-interactive !border-transparent !bg-transparent hover:!bg-secondary/30 hover:!text-foreground typo-label whitespace-nowrap [&>span]:block [&>span]:truncate"
                />
              </div>
            );
          }

          /* Sortable header */
          if (col.sortable && onSort) {
            return (
              <SortableHeader
                key={col.key}
                as="div"
                label={col.label}
                active={sortKey === col.key}
                dir={sortDirection}
                onSort={() => onSort(col.key)}
                align={col.align === 'right' ? 'right' : 'left'}
                padding={headerPadCls}
                // Headers never wrap. SortableHeader's label is a bare string in a flex
                // button, so a cut label clips rather than ellipsizes; its aria-label
                // ("Sort by <label>") still carries the whole name.
                className="min-w-0"
                buttonClassName="whitespace-nowrap overflow-hidden"
              />
            );
          }

          /* Plain header */
          return (
            <div
              key={col.key}
              className={`${headerPadCls} flex items-center min-w-0 typo-label text-foreground ${
                col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''
              }`}
            >
              {/* One line; the full label in a Tooltip only when it is actually cut. */}
              <TruncateWithTooltip text={col.label} />
            </div>
          );
        })}
      </div>

      {/* A failed refresh with rows on screen: keep the rows, say so inline. */}
      {error && data.length > 0 && (
        <ErrorBanner variant="inline" message={error} onRetry={onRetry} />
      )}

      {/* Rows (ghost while loading-into-emptiness / settled empty / data) */}
      {isLoading && data.length === 0 ? (
        /* Loading pattern v2: calm delayed ghost rows under the permanent
           column header — the ≥120ms animation-delay (fill-mode: both) keeps
           them invisible for fast fetches, and a refetch with rows on screen
           never reaches this branch (data stays visible). */
        <div role="status" aria-live="polite">
          <span className="sr-only">{loadingLabel ?? t.shared.grid_loading}</span>
          <div aria-hidden="true">
            {Array.from({ length: 6 }).map((_, r) => (
              <div
                key={r}
                className={`grid gap-0 border-b border-primary/5 border-l-2 border-l-transparent animate-fade-in ${r % 2 === 0 ? 'bg-primary/[0.03]' : ''}`}
                style={{ gridTemplateColumns: gridTemplate, animationDelay: `${120 + r * 35}ms` }}
              >
                {columns.map((col, ci) => (
                  <div key={col.key} className={`${rowPadCls} flex items-center min-w-0 ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}`}>
                    <span className={`inline-block h-3.5 rounded bg-primary/[0.06] ${['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3'][(r + ci) % 4]}`} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : error && data.length === 0 ? (
        /* Failed into emptiness — "I couldn't look", never "there is nothing". */
        <ErrorBanner variant="panel" message={error} onRetry={onRetry} />
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-10 h-10 rounded-xl bg-secondary/30 border border-primary/10 flex items-center justify-center mb-3">
            <Icon className="w-5 h-5 text-foreground/90" />
          </div>
          {/* No hardcoded English fallback: an untranslated default leaks into
              all 14 locales. `shared.grid_no_data` is the shared translated
              last resort — always pass a specific `emptyTitle` instead. */}
          <p className="typo-heading text-foreground">{emptyTitle ?? t.shared.grid_no_data}</p>
          {emptyDescription && (
            <p className="typo-body text-foreground mt-1 max-w-xs">{emptyDescription}</p>
          )}
        </div>
      ) : (
      <div
        data-testid="data-grid-body"
        // 'content' sizes the body to its rows and lets it shrink (min-h-0) when
        // the grid is capped, so it scrolls only past the available height.
        className={fit === 'page' ? '' : fit === 'content' ? 'min-h-0 overflow-y-auto' : 'flex-1 overflow-y-auto'}
        // Remount per page so the scroll offset resets to the top; the row
        // entrance stays id-guarded, so this never replays seen rows' fades.
        key={`page-${page}`}
      >
        {pageData.map((row, idx) => {
          const selected = isRowSelected?.(row) ?? false;
          // When a row is selected the bulk-list affordance (left accent + tint)
          // takes precedence over status accents from getRowAccent — the user's
          // current selection should be the dominant visual signal.
          const accent = selected
            ? 'border-l-primary bg-primary/[0.06]'
            : (getRowAccent?.(row) ?? '');
          const rowCls = getRowClassName?.(row) ?? '';
          const extraRowProps = getRowProps?.(row);
          // Drag-affordance treatment: the dragged row lifts; siblings dim.
          const isDragging = draggingRowKey != null && getRowKey(row) === draggingRowKey;
          const isDragSibling = draggingRowKey != null && !isDragging;
          const dragCls = isDragging
            ? 'scale-[0.98] shadow-elevation-3 relative z-10'
            : isDragSibling
              ? 'opacity-70'
              : '';
          const entrance = rowEntrance(getRowKey(row), idx);
          return (
            <motion.div
              key={getRowKey(row)}
              // Cast: motion.div's own onDragStart (for framer pan drags) shadows
              // the React HTML5 DragEvent signature in TypeScript, but at runtime
              // React forwards the HTML5 drag handlers to the underlying DOM div
              // — framer's pan system is inactive while `drag` prop is false
              // (the default), so the two don't fight.
              {...(extraRowProps as React.ComponentProps<typeof motion.div>)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onAnimationEnd={entrance?.onAnimationEnd}
              data-selected={selected || undefined}
              className={`row-hover-lift grid gap-0 border-b border-primary/5 border-l-2 border-l-transparent hover:bg-primary/[0.12] transition-[transform,opacity,box-shadow] duration-150 ${accent} ${rowCls} ${dragCls} ${
                onRowClick ? 'cursor-pointer' : ''
              } ${idx % 2 === 0 && !selected ? 'bg-primary/[0.03]' : ''} ${entrance?.className ?? ''}`}
              style={{ gridTemplateColumns: gridTemplate, contain: 'layout paint style', ...entrance?.style }}
            >
              {columns.map((col) => (
                <div
                  key={col.key}
                  className={`${rowPadCls} flex items-center min-w-0 ${col.nowrap ? 'whitespace-nowrap' : ''} ${
                    col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''
                  }`}
                >
                  {col.render(row, idx)}
                </div>
              ))}
            </motion.div>
          );
        })}
      </div>
      )}

      {/* Bulk-action toolbar — slides up when rows are selected. Under
          fit='page' the grid can be taller than the screen, so the toolbar hangs
          from a zero-height sticky rail that stays at the scroller's bottom edge. */}
      <BulkToolbarRail page={fit === 'page'}>
      <AnimatePresence>
        {showBulkToolbar && (
          <motion.div
            key="bulk-toolbar"
            role="toolbar"
            aria-label={t.shared.bulk_toolbar_aria}
            initial={shouldAnimate ? { y: 12, opacity: 0 } : { opacity: 1 }}
            animate={{ y: 0, opacity: 1 }}
            exit={shouldAnimate ? { y: 12, opacity: 0 } : { opacity: 0 }}
            transition={shouldAnimate
              ? { duration: 0.22, ease: EASE_CURVE }
              : { duration: 0.01 }}
            className="pointer-events-none absolute left-1/2 z-30 -translate-x-1/2"
            style={{ bottom: fit === 'page' ? '0px' : effectivePageSize > 0 ? '52px' : '12px' }}
          >
            <div className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-modal border border-primary/20 bg-secondary/80 shadow-elevation-3 backdrop-blur-md">
              <span className="typo-body text-foreground px-2">
                {tx(t.shared.bulk_selected, { count: selectedCount })}
              </span>
              <div className="w-px h-5 bg-primary/15" />
              <div className="flex items-center gap-1">
                {bulkActions!.map((action) => {
                  const ActionIcon = action.icon;
                  const isDanger = action.variant === 'danger';
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={action.onClick}
                      disabled={action.disabled}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-label transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDanger
                          ? 'text-red-400 hover:bg-red-500/15'
                          : 'text-foreground hover:bg-secondary/60'
                      }`}
                    >
                      {ActionIcon && <ActionIcon className="w-3.5 h-3.5" />}
                      {action.label}
                    </button>
                  );
                })}
              </div>
              {onClearSelection && (
                <>
                  <div className="w-px h-5 bg-primary/15" />
                  <button
                    type="button"
                    onClick={onClearSelection}
                    aria-label={t.shared.bulk_clear_selection}
                    className="p-1.5 rounded-card text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </BulkToolbarRail>

      {/* Pagination */}
      {effectivePageSize > 0 && (
        <DataGridPager
          page={page}
          totalPages={totalPages}
          pageSize={effectivePageSize}
          pageSizeOptions={pageSizeOptions}
          total={data.length}
          onPage={setPage}
          onPageSize={(newSize) => {
            setInternalPageSize(newSize);
            setPage(1);
            onPageSizeChange?.(newSize);
          }}
        />
      )}
    </div>
  );
}

/** Under fit='page', a zero-height rail stuck to the page scroller's bottom edge; otherwise nothing. */
function BulkToolbarRail({ page, children }: { page: boolean; children: React.ReactNode }) {
  if (!page) return <>{children}</>;
  return <div className="sticky bottom-3 z-30 h-0">{children}</div>;
}
