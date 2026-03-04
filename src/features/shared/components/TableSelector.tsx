import { useState, useMemo } from 'react';
import { Search, RefreshCw, Loader2, Table2, CheckSquare, Square } from 'lucide-react';
import type { IntrospectedTable } from '@/hooks/database/useTableIntrospection';

interface TableSelectorProps {
  tables: IntrospectedTable[];
  selectedTables: string[];
  onSelectionChange: (tables: string[]) => void;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  maxHeight?: string;
}

export function TableSelector({
  tables,
  selectedTables,
  onSelectionChange,
  loading = false,
  error = null,
  onRefresh,
  maxHeight = '240px',
}: TableSelectorProps) {
  const [filter, setFilter] = useState('');

  const selectedSet = useMemo(() => new Set(selectedTables), [selectedTables]);

  const filteredTables = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.table_name.toLowerCase().includes(q));
  }, [tables, filter]);

  const toggleTable = (tableName: string) => {
    if (selectedSet.has(tableName)) {
      onSelectionChange(selectedTables.filter((t) => t !== tableName));
    } else {
      onSelectionChange([...selectedTables, tableName]);
    }
  };

  const toggleAll = () => {
    const allFilteredNames = filteredTables.map((t) => t.table_name);
    const allSelected = allFilteredNames.every((n) => selectedSet.has(n));
    if (allSelected) {
      // Deselect all filtered
      const remaining = selectedTables.filter((t) => !allFilteredNames.includes(t));
      onSelectionChange(remaining);
    } else {
      // Select all filtered (merge with existing)
      const merged = new Set([...selectedTables, ...allFilteredNames]);
      onSelectionChange([...merged]);
    }
  };

  const allFilteredSelected = filteredTables.length > 0 && filteredTables.every((t) => selectedSet.has(t.table_name));

  return (
    <div className="rounded-lg border border-primary/10 bg-secondary/5 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-primary/8">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/30" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables..."
            className="w-full pl-6 pr-2 py-1 rounded-md bg-background/50 border border-primary/8 text-[11px] text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/25 transition-colors"
          />
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1 rounded-md text-muted-foreground/40 hover:text-foreground/70 hover:bg-secondary/40 disabled:opacity-40 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* Select all / none */}
      {filteredTables.length > 0 && (
        <button
          type="button"
          onClick={toggleAll}
          className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-secondary/20 border-b border-primary/5 transition-colors"
        >
          {allFilteredSelected ? (
            <CheckSquare className="w-3 h-3 text-primary/60" />
          ) : (
            <Square className="w-3 h-3" />
          )}
          {allFilteredSelected ? 'Deselect all' : 'Select all'}
          <span className="ml-auto text-muted-foreground/30">{filteredTables.length}</span>
        </button>
      )}

      {/* Table list */}
      <div className="overflow-y-auto" style={{ maxHeight }}>
        {loading && tables.length === 0 && (
          <div className="flex items-center justify-center py-6 gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/40" />
            <span className="text-[11px] text-muted-foreground/40">Loading tables...</span>
          </div>
        )}

        {error && (
          <div className="p-2 mx-2 my-1.5 rounded-md bg-red-500/10 border border-red-500/15 text-[11px] text-red-400 break-words">
            {error}
          </div>
        )}

        {!loading && !error && filteredTables.length === 0 && tables.length === 0 && (
          <p className="text-[11px] text-muted-foreground/40 text-center py-6">
            No tables found
          </p>
        )}

        {!loading && !error && filteredTables.length === 0 && tables.length > 0 && (
          <p className="text-[11px] text-muted-foreground/40 text-center py-6">
            No matching tables
          </p>
        )}

        {filteredTables.map((table) => {
          const isChecked = selectedSet.has(table.table_name);
          return (
            <button
              key={table.table_name}
              type="button"
              onClick={() => toggleTable(table.table_name)}
              className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors ${
                isChecked
                  ? 'bg-primary/8 hover:bg-primary/12'
                  : 'hover:bg-secondary/30'
              }`}
            >
              {isChecked ? (
                <CheckSquare className="w-3 h-3 text-primary/70 shrink-0" />
              ) : (
                <Square className="w-3 h-3 text-muted-foreground/25 shrink-0" />
              )}
              <Table2 className="w-2.5 h-2.5 text-muted-foreground/30 shrink-0" />
              <span className="flex-1 text-[11px] font-mono text-foreground/70 truncate">
                {table.table_name}
              </span>
              {table.table_type === 'VIEW' && (
                <span className="px-1 py-0.5 rounded text-[9px] font-medium bg-violet-500/10 text-violet-400/70 shrink-0">
                  VIEW
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      {selectedTables.length > 0 && (
        <div className="px-2.5 py-1.5 border-t border-primary/5 text-[10px] text-muted-foreground/40">
          {selectedTables.length} of {tables.length} table{tables.length !== 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
}
