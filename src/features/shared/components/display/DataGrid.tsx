import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { ChevronLeft, ChevronRight, Inbox, X } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { SortableHeader } from '@/features/shared/components/display/SortableHeader';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
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
  /** Align content: 'left' (default) | 'right' */
  align?: 'left' | 'right';
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
  /** Loading state */
  isLoading?: boolean;
  loadingLabel?: string;
  /** Empty state */
  emptyIcon?: React.ComponentType<{ className?: string }>;
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
  /** Optional className for the outer container */
  className?: string;
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

/* -- Stagger animation variants --------------------------------------- */

const EASE_CURVE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const STAGGER_CAP = 10;

const gridContainerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const gridRowVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.15, ease: EASE_CURVE } },
};

const gridRowReduced: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.01 } },
};

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
  loadingLabel = 'Loading...',
  emptyIcon: EmptyIcon,
  emptyTitle = 'No data',
  emptyDescription,
  getRowClassName,
  getRowProps,
  className,
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
  const headerPadCls = `px-4 ${densityTokens.headerPaddingY}`;
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

  // Reset page when data length changes significantly (filters changed)
  useEffect(() => { setPage(1); }, [data.length]);

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

  const { shouldAnimate } = useMotion();
  const rowVariants = shouldAnimate ? gridRowVariants : gridRowReduced;

  const Icon = EmptyIcon || Inbox;

  /* -- Loading ----------------------------------------------------- */
  if (isLoading) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 ${className ?? ''}`}>
        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
        <span className="typo-body text-foreground">{loadingLabel}</span>
      </div>
    );
  }

  /* -- Grid --------------------------------------------------------- */
  return (
    <div className={`relative flex flex-col min-h-0 ${className ?? ''}`}>
      {/* Header — always visible so filter controls remain accessible */}
      <div
        className="grid gap-0 border-b border-primary/10 bg-background sticky top-0 z-20"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((col) => {
          /* Select-all checkbox header */
          if (col.key === 'select' && onSelectAll) {
            return (
              <div key={col.key} className={`${headerPadCls} flex items-center justify-center`}>
                <div
                  onClick={onSelectAll}
                  className={`w-4 h-4 rounded-sm border-2 transition-all flex items-center justify-center cursor-pointer ${
                    selectAll
                      ? 'bg-primary/80 border-primary/60'
                      : 'border-primary/30 hover:border-primary/50'
                  }`}
                >
                  {selectAll && (
                    <svg className="w-3 h-3 text-btn-primary-fg" viewBox="0 0 12 12" fill="none">
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
              <div key={col.key} className={`px-2 ${densityTokens.headerPaddingY} flex items-center`}>
                {col.filterComponent}
              </div>
            );
          }

          /* Filterable header (hidden in simplified mode) */
          if (!simplified && col.filterOptions && col.onFilterChange) {
            return (
              <div key={col.key} className={`px-2 ${densityTokens.headerPaddingY} flex items-center`}>
                <ThemedSelect
                  filterable
                  options={col.filterOptions}
                  value={col.filterValue ?? ''}
                  onValueChange={col.onFilterChange}
                  placeholder={col.label}
                  className="!px-2 !py-0 !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 hover:!text-foreground typo-label"
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
              />
            );
          }

          /* Plain header */
          return (
            <div
              key={col.key}
              className={`${headerPadCls} flex items-center typo-label text-foreground ${
                col.align === 'right' ? 'justify-end' : ''
              }`}
            >
              {col.label}
            </div>
          );
        })}
      </div>

      {/* Rows (or empty state) */}
      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-10 h-10 rounded-xl bg-secondary/30 border border-primary/10 flex items-center justify-center mb-3">
            <Icon className="w-5 h-5 text-foreground/90" />
          </div>
          <p className="typo-heading text-foreground">{emptyTitle}</p>
          {emptyDescription && (
            <p className="typo-body text-foreground mt-1 max-w-xs">{emptyDescription}</p>
          )}
        </div>
      ) : (
      <motion.div
        className="flex-1 overflow-y-auto"
        variants={gridContainerVariants}
        initial="hidden"
        animate="show"
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
          return (
            <motion.div
              key={getRowKey(row)}
              variants={rowVariants}
              {...(idx >= STAGGER_CAP ? { transition: { duration: 0.01 } } : {})}
              // Cast: motion.div's own onDragStart (for framer pan drags) shadows
              // the React HTML5 DragEvent signature in TypeScript, but at runtime
              // React forwards the HTML5 drag handlers to the underlying DOM div
              // — framer's pan system is inactive while `drag` prop is false
              // (the default), so the two don't fight.
              {...(extraRowProps as React.ComponentProps<typeof motion.div>)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              data-selected={selected || undefined}
              className={`row-hover-lift grid gap-0 border-b border-primary/5 border-l-2 border-l-transparent hover:bg-primary/[0.12] ${accent} ${rowCls} ${
                onRowClick ? 'cursor-pointer' : ''
              } ${idx % 2 === 0 && !selected ? 'bg-primary/[0.03]' : ''}`}
              style={{ gridTemplateColumns: gridTemplate, contain: 'layout paint style' }}
            >
              {columns.map((col) => (
                <div
                  key={col.key}
                  className={`${rowPadCls} flex items-center min-w-0 ${
                    col.align === 'right' ? 'justify-end' : ''
                  }`}
                >
                  {col.render(row, idx)}
                </div>
              ))}
            </motion.div>
          );
        })}
      </motion.div>
      )}

      {/* Bulk-action toolbar — slides up when rows are selected */}
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
            style={{ bottom: effectivePageSize > 0 ? '52px' : '12px' }}
          >
            <div className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-modal border border-primary/20 bg-secondary/80 shadow-elevation-3 backdrop-blur-md">
              <span className="typo-body text-foreground font-medium px-2">
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

      {/* Pagination */}
      {effectivePageSize > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-primary/10 bg-background/60 shrink-0">
          {/* Left: page-size selector + item range */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="typo-code text-foreground/90 text-[11px]">{t.shared.grid_rows}</span>
              <select
                value={effectivePageSize}
                onChange={(e) => {
                  const newSize = Number(e.target.value);
                  setInternalPageSize(newSize);
                  setPage(1);
                  onPageSizeChange?.(newSize);
                }}
                data-testid="page-size-select"
                aria-label={t.shared.grid_rows_per_page}
                className="typo-code text-[11px] bg-secondary/30 border border-primary/10 rounded-md px-1.5 py-0.5 text-foreground hover:bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer appearance-auto"
              >
                {pageSizeOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <span className="typo-code text-foreground/90 text-[11px]">
              {t.shared.grid_showing
                .replace('{start}', String(Math.min((page - 1) * effectivePageSize + 1, data.length)))
                .replace('{end}', String(Math.min(page * effectivePageSize, data.length)))
                .replace('{total}', String(data.length))}
            </span>
          </div>
          {/* Right: page buttons */}
          {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="p-1 rounded-lg text-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 5) p = i + 1;
              else if (page <= 3) p = i + 1;
              else if (page >= totalPages - 2) p = totalPages - 4 + i;
              else p = page - 2 + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded-lg typo-code transition-colors ${
                    p === page
                      ? 'bg-primary/10 text-foreground font-semibold border border-primary/20'
                      : 'text-foreground hover:text-foreground hover:bg-secondary/40'
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded-lg text-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
