import { useState, useMemo, useEffect } from 'react';
import { motion, type Variants } from 'framer-motion';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

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
  /** Optional className for the outer container */
  className?: string;
  /** When true, hides column filters and reduces page size to 5. */
  simplified?: boolean;
  /** Whether all rows are selected (renders a header checkbox for the first column) */
  selectAll?: boolean;
  /** Toggle select-all callback */
  onSelectAll?: () => void;
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
  className,
  simplified = false,
  selectAll,
  onSelectAll,
}: DataGridProps<T>) {
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
    <div className={`flex flex-col min-h-0 ${className ?? ''}`}>
      {/* Header — always visible so filter controls remain accessible */}
      <div
        className="grid gap-0 border-b border-primary/10 bg-background sticky top-0 z-20"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((col) => {
          const isSorted = sortKey === col.key;
          const SortIcon = isSorted
            ? sortDirection === 'asc' ? ArrowUp : ArrowDown
            : ArrowUpDown;

          /* Select-all checkbox header */
          if (col.key === 'select' && onSelectAll) {
            return (
              <div key={col.key} className="px-4 py-2.5 flex items-center justify-center">
                <div
                  onClick={onSelectAll}
                  className={`w-4 h-4 rounded-sm border-2 transition-all flex items-center justify-center cursor-pointer ${
                    selectAll
                      ? 'bg-primary/80 border-primary/60'
                      : 'border-primary/30 hover:border-primary/50'
                  }`}
                >
                  {selectAll && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
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
              <div key={col.key} className="px-2 py-2.5 flex items-center">
                {col.filterComponent}
              </div>
            );
          }

          /* Filterable header (hidden in simplified mode) */
          if (!simplified && col.filterOptions && col.onFilterChange) {
            return (
              <div key={col.key} className="px-2 py-2.5 flex items-center">
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
              <button
                key={col.key}
                type="button"
                onClick={() => onSort(col.key)}
                className={`px-4 py-2.5 typo-label text-foreground flex items-center gap-1 hover:text-foreground transition-colors focus-ring ${
                  col.align === 'right' ? 'justify-end' : ''
                }`}
                aria-sort={isSorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {col.label}
                <SortIcon className={`w-3 h-3 ${isSorted ? 'text-foreground' : 'text-foreground/40'}`} />
              </button>
            );
          }

          /* Plain header */
          return (
            <div
              key={col.key}
              className={`px-4 py-2.5 flex items-center typo-label text-foreground ${
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
          const accent = getRowAccent?.(row) ?? '';
          const rowCls = getRowClassName?.(row) ?? '';
          return (
            <motion.div
              key={getRowKey(row)}
              variants={rowVariants}
              {...(idx >= STAGGER_CAP ? { transition: { duration: 0.01 } } : {})}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`grid gap-0 transition-colors border-b border-primary/5 border-l-2 border-l-transparent hover:bg-white/[0.05] ${accent} ${rowCls} ${
                onRowClick ? 'cursor-pointer' : ''
              } ${idx % 2 === 0 ? 'bg-white/[0.015]' : ''}`}
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {columns.map((col) => (
                <div
                  key={col.key}
                  className={`px-4 py-2 flex items-center min-w-0 ${
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

      {/* Pagination */}
      {effectivePageSize > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-primary/10 bg-background/60 shrink-0">
          {/* Left: page-size selector + item range */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="typo-code text-foreground/90 text-[11px]">Rows</span>
              <select
                value={effectivePageSize}
                onChange={(e) => {
                  const newSize = Number(e.target.value);
                  setInternalPageSize(newSize);
                  setPage(1);
                  onPageSizeChange?.(newSize);
                }}
                data-testid="page-size-select"
                aria-label="Rows per page"
                className="typo-code text-[11px] bg-secondary/30 border border-primary/10 rounded-md px-1.5 py-0.5 text-foreground hover:bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer appearance-auto"
              >
                {pageSizeOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <span className="typo-code text-foreground/90 text-[11px]">
              Showing {Math.min((page - 1) * effectivePageSize + 1, data.length)}–{Math.min(page * effectivePageSize, data.length)} of {data.length} items
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
                      : 'text-foreground/60 hover:text-foreground hover:bg-secondary/40'
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
