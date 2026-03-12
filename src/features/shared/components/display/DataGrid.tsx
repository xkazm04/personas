import { useState, useMemo, useEffect } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

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
  /** Loading state */
  isLoading?: boolean;
  loadingLabel?: string;
  /** Empty state */
  emptyIcon?: React.ComponentType<{ className?: string }>;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Optional className for the outer container */
  className?: string;
  /** When true, hides column filters and reduces page size to 5. */
  simplified?: boolean;
}

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
  isLoading = false,
  loadingLabel = 'Loading...',
  emptyIcon: EmptyIcon,
  emptyTitle = 'No data',
  emptyDescription,
  className,
  simplified = false,
}: DataGridProps<T>) {
  const [page, setPage] = useState(1);
  const effectivePageSize = simplified && pageSize === 0 ? 5 : pageSize;

  // Reset page when data length changes significantly (filters changed)
  useEffect(() => { setPage(1); }, [data.length]);

  const gridTemplate = columns.map((c) => c.width).join(' ');

  const totalPages = effectivePageSize > 0 ? Math.max(1, Math.ceil(data.length / effectivePageSize)) : 1;
  const pageData = useMemo(() => {
    if (effectivePageSize <= 0) return data;
    const start = (page - 1) * effectivePageSize;
    return data.slice(start, start + effectivePageSize);
  }, [data, page, effectivePageSize]);

  const Icon = EmptyIcon || Inbox;

  /* -- Loading ----------------------------------------------------- */
  if (isLoading) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 ${className ?? ''}`}>
        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
        <span className="text-sm text-muted-foreground/70">{loadingLabel}</span>
      </div>
    );
  }

  /* -- Empty -------------------------------------------------------- */
  if (data.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 text-center ${className ?? ''}`}>
        <div className="w-10 h-10 rounded-xl bg-secondary/30 border border-primary/10 flex items-center justify-center mb-3">
          <Icon className="w-5 h-5 text-muted-foreground/40" />
        </div>
        <p className="text-sm font-medium text-foreground/70">{emptyTitle}</p>
        {emptyDescription && (
          <p className="text-sm text-muted-foreground/50 mt-1 max-w-xs">{emptyDescription}</p>
        )}
      </div>
    );
  }

  /* -- Grid --------------------------------------------------------- */
  return (
    <div className={`flex flex-col min-h-0 ${className ?? ''}`}>
      {/* Header */}
      <div
        className="grid gap-0 border-b border-primary/10 bg-background sticky top-0 z-20"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((col) => {
          const isSorted = sortKey === col.key;
          const SortIcon = isSorted
            ? sortDirection === 'asc' ? ArrowUp : ArrowDown
            : ArrowUpDown;

          /* Filterable header (hidden in simplified mode) */
          if (!simplified && col.filterOptions && col.onFilterChange) {
            return (
              <div key={col.key} className="px-2 py-1.5">
                <ThemedSelect
                  filterable
                  options={col.filterOptions}
                  value={col.filterValue ?? ''}
                  onValueChange={col.onFilterChange}
                  placeholder={col.label}
                  className="!px-2 !py-1 !text-xs !rounded-lg !border-transparent !bg-transparent !text-foreground/80 hover:!bg-secondary/30 hover:!text-foreground uppercase tracking-wider font-semibold"
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
                className={`px-4 py-2.5 text-xs text-foreground/80 uppercase tracking-wider font-semibold flex items-center gap-1 hover:text-foreground transition-colors ${
                  col.align === 'right' ? 'justify-end' : ''
                }`}
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
              className={`px-4 py-2.5 text-xs text-foreground/80 uppercase tracking-wider font-semibold ${
                col.align === 'right' ? 'text-right' : ''
              }`}
            >
              {col.label}
            </div>
          );
        })}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {pageData.map((row, idx) => {
          const accent = getRowAccent?.(row) ?? '';
          return (
            <div
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`grid gap-0 transition-colors border-b border-primary/5 border-l-2 border-l-transparent hover:bg-white/[0.05] ${accent} ${
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
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {effectivePageSize > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-primary/10 bg-background/60 shrink-0">
          <span className="text-xs text-foreground/60 font-mono">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="p-1 rounded-lg text-foreground/70 hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                  className={`w-7 h-7 rounded-lg text-xs font-mono transition-colors ${
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
              className="p-1 rounded-lg text-foreground/70 hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
