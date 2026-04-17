/**
 * UnifiedTable — golden standard table component for all list views.
 *
 * Design baseline: Activity table's visual quality (rounded borders, clean rows).
 * Features: column sorting, dropdown filters, search, virtual list, row click.
 * Column headers show distinct action icons: ArrowUpDown (sort), Filter (dropdown), Search.
 */
import { useState, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Filter, Search, X } from 'lucide-react';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TableColumn<T> {
  key: string;
  label: string;
  /** CSS grid width, e.g. "1fr", "120px", "minmax(100px, 1fr)" */
  width: string;
  /** Render cell content */
  render: (row: T, index: number) => ReactNode;
  /** Enable sorting on this column */
  sortable?: boolean;
  /** Sort comparator — if omitted, sorts by string value of key */
  sortFn?: (a: T, b: T) => number;
  /** Dropdown filter options */
  filterOptions?: { value: string; label: string }[];
  /** Current filter value (controlled) */
  filterValue?: string;
  /** Filter change handler (controlled) */
  onFilterChange?: (value: string) => void;
  /** Custom filter component (e.g. PersonaColumnFilter) */
  filterComponent?: ReactNode;
  /** Enable inline search on this column */
  searchable?: boolean;
  /** Current search value (controlled) */
  searchValue?: string;
  /** Search change handler (controlled) */
  onSearchChange?: (value: string) => void;
  /** Align: 'left' (default) | 'right' */
  align?: 'left' | 'right';
  /** Hide this column on small screens */
  hideOnMobile?: boolean;
}

export interface UnifiedTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Row height for virtual list (0 = no virtual list) */
  rowHeight?: number;
  /** Empty state */
  emptyTitle?: string;
  emptyDescription?: string;
  isLoading?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Column header with action icons
// ---------------------------------------------------------------------------

function ColumnHeader<T>({
  col, sortKey, sortDir, onSort,
}: {
  col: TableColumn<T>;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [showFilter, setShowFilter] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close filter dropdown on outside click
  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (filterRef.current && !filterRef.current.contains(e.relatedTarget as Node)) {
      setShowFilter(false);
    }
  }, []);

  const isSorted = sortKey === col.key;
  const hasFilter = !!(col.filterOptions && col.onFilterChange) || !!col.filterComponent;
  const hasSearch = col.searchable && col.onSearchChange;
  const isFiltered = !!(col.filterValue && col.filterValue !== '' && col.filterValue !== 'all');
  const isSearched = !!(col.searchValue && col.searchValue.trim());

  // Custom filter component takes full control
  if (col.filterComponent) {
    return (
      <div className={`flex items-center gap-1 px-4 py-2.5 ${col.align === 'right' ? 'justify-end' : ''}`}>
        {col.filterComponent}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1 px-4 py-2.5 ${col.align === 'right' ? 'justify-end' : ''}`}>
      <span className="text-sm font-semibold text-foreground uppercase tracking-wider">{col.label}</span>

      {/* Sort icon */}
      {col.sortable && (
        <button
          onClick={() => onSort(col.key)}
          className={`p-0.5 rounded transition-colors ${isSorted ? 'text-primary' : 'text-muted-foreground/30 hover:text-muted-foreground/60'}`}
          title={t.shared.sort_by.replace('{label}', col.label)}
        >
          {isSorted ? (
            sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
          ) : (
            <ArrowUpDown className="w-3.5 h-3.5" />
          )}
        </button>
      )}

      {/* Filter icon + dropdown */}
      {hasFilter && !col.filterComponent && (
        <div ref={filterRef} className="relative" onBlur={handleBlur}>
          <button
            onClick={() => { setShowFilter(!showFilter); setShowSearch(false); }}
            className={`p-0.5 rounded transition-colors ${isFiltered ? 'text-primary' : 'text-muted-foreground/30 hover:text-muted-foreground/60'}`}
            title={t.shared.filter_label.replace('{label}', col.label)}
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
          {showFilter && col.filterOptions && (
            <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] rounded-xl border border-primary/15 bg-background shadow-elevation-3 overflow-hidden">
              {col.filterOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { col.onFilterChange!(opt.value); setShowFilter(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    col.filterValue === opt.value ? 'bg-primary/10 text-foreground' : 'text-muted-foreground/70 hover:bg-secondary/30'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search icon + inline input */}
      {hasSearch && (
        <>
          {showSearch ? (
            <div className="flex items-center gap-1 ml-1">
              <input
                type="text"
                value={col.searchValue ?? ''}
                onChange={(e) => col.onSearchChange!(e.target.value)}
                placeholder={t.shared.search_ellipsis}
                autoFocus
                className="w-24 px-2 py-0.5 rounded-lg text-sm bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground/90 outline-none focus-visible:border-primary/25"
              />
              <button
                onClick={() => { col.onSearchChange!(''); setShowSearch(false); }}
                className="p-0.5 text-foreground/90 hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setShowSearch(true); setShowFilter(false); }}
              className={`p-0.5 rounded transition-colors ${isSearched ? 'text-primary' : 'text-muted-foreground/30 hover:text-muted-foreground/60'}`}
              title={t.shared.search_label.replace('{label}', col.label)}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UnifiedTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  rowHeight = 0,
  emptyTitle = 'No data',
  emptyDescription,
  isLoading,
  className,
}: UnifiedTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  // Apply client-side sorting
  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;
    const sorted = [...data];
    if (col.sortFn) {
      sorted.sort(col.sortFn);
    } else {
      sorted.sort((a, b) => {
        const av = String((a as Record<string, unknown>)[sortKey] ?? '');
        const bv = String((b as Record<string, unknown>)[sortKey] ?? '');
        return av.localeCompare(bv);
      });
    }
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [data, sortKey, sortDir, columns]);

  const gridTemplate = columns.map((c) => c.width).join(' ');

  // Virtual list: enable whenever rowHeight is provided so rows are always in a
  // bounded scroll container (important on small displays).
  const useVirtual = rowHeight > 0;
  const { parentRef, virtualizer } = useVirtualList(sortedData, useVirtual ? rowHeight : 44);

  const { t } = useTranslation();

  if (isLoading) {
    return <div className="py-8 text-center text-foreground text-sm">{t.common.loading}</div>;
  }

  return (
    <div className={`border border-primary/10 rounded-xl overflow-hidden flex flex-col min-h-0 ${className ?? ''}`}>
      {/* Header */}
      <div
        className="grid bg-primary/5 border-b border-primary/10"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((col) => (
          <ColumnHeader key={col.key} col={col} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
        ))}
      </div>

      {sortedData.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-foreground">{emptyTitle}</p>
          {emptyDescription && <p className="text-sm text-foreground/90 mt-1">{emptyDescription}</p>}
        </div>
      ) : null}

      {/* Rows */}
      {sortedData.length > 0 && (useVirtual ? (
        <div ref={parentRef} className="flex-1 overflow-y-auto min-h-0">
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = sortedData[vRow.index]!;
              return (
                <div
                  key={getRowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  style={{ position: 'absolute', top: 0, transform: `translateY(${vRow.start}px)`, width: '100%', height: `${vRow.size}px`, gridTemplateColumns: gridTemplate }}
                  className={`grid items-center transition-colors hover:bg-primary/[0.08] ${onRowClick ? 'cursor-pointer' : ''} ${vRow.index > 0 ? 'border-t border-primary/[0.06]' : ''} ${vRow.index % 2 === 0 ? 'bg-primary/[0.03]' : ''}`}
                >
                  {columns.map((col) => (
                    <div key={col.key} className={`px-4 min-w-0 ${col.align === 'right' ? 'text-right' : ''}`}>
                      {col.render(row, vRow.index)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          {sortedData.map((row, idx) => (
            <div
              key={getRowKey(row)}
              onClick={() => onRowClick?.(row)}
              style={{ gridTemplateColumns: gridTemplate }}
              className={`grid items-center px-0 py-2.5 transition-colors hover:bg-primary/[0.08] ${onRowClick ? 'cursor-pointer' : ''} ${idx > 0 ? 'border-t border-primary/[0.06]' : ''} ${idx % 2 === 0 ? 'bg-primary/[0.03]' : ''}`}
            >
              {columns.map((col) => (
                <div key={col.key} className={`px-4 min-w-0 ${col.align === 'right' ? 'text-right' : ''}`}>
                  {col.render(row, idx)}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
