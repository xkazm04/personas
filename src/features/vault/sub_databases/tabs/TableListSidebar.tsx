import { RefreshCw, Search, Loader2, Table2, Pin, Key, ChevronRight } from 'lucide-react';
import type { IntrospectedTable, RedisKeyInfo } from '@/hooks/database/useTableIntrospection';

interface TableListSidebarProps {
  tables: IntrospectedTable[];
  redisKeys: RedisKeyInfo[];
  loading: boolean;
  error: string | null;
  isRedis: boolean;
  filter: string;
  onFilterChange: (v: string) => void;
  selectedTable: string | null;
  selectedKey: string | null;
  pinnedTableNames: Set<string>;
  onSelectTable: (name: string) => void;
  onSelectKey: (key: string) => void;
  onRefresh: () => void;
  onContextMenu: (e: React.MouseEvent, tableName: string) => void;
}

export function TableListSidebar({
  tables,
  redisKeys,
  loading,
  error,
  isRedis,
  filter,
  onFilterChange,
  selectedTable,
  selectedKey,
  pinnedTableNames,
  onSelectTable,
  onSelectKey,
  onRefresh,
  onContextMenu,
}: TableListSidebarProps) {
  const q = filter.trim().toLowerCase();
  const filteredTables = q
    ? tables.filter((t) => t.table_name.toLowerCase().includes(q))
    : tables;
  const filteredKeys = q
    ? redisKeys.filter((k) => k.key.toLowerCase().includes(q))
    : redisKeys;

  return (
    <div className="w-72 border-r border-primary/10 flex flex-col shrink-0">
      {/* Toolbar */}
      <div className="p-3 border-b border-primary/5 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
            <input
              type="text"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder={isRedis ? 'Filter keys...' : 'Filter tables...'}
              className="w-full pl-7 pr-2 py-1.5 rounded-xl bg-secondary/30 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
            />
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground/70 hover:bg-secondary/40 disabled:opacity-40 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {loading && tables.length === 0 && redisKeys.length === 0 && (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/60" />
            <span className="text-sm text-muted-foreground/60">Loading...</span>
          </div>
        )}

        {error && (
          <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 break-words">
            {error}
          </div>
        )}

        {/* SQL tables */}
        {!isRedis && !loading && !error && filteredTables.length === 0 && tables.length === 0 && (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No tables found
          </p>
        )}

        {!isRedis && !loading && !error && filteredTables.length === 0 && tables.length > 0 && (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No matching tables
          </p>
        )}

        {!isRedis && filteredTables.map((table) => {
          const isSelected = selectedTable === table.table_name;
          const isPinned = pinnedTableNames.has(table.table_name);
          return (
            <div
              key={table.table_name}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-secondary/40 border border-transparent'
              }`}
              onClick={() => onSelectTable(table.table_name)}
              onContextMenu={(e) => onContextMenu(e, table.table_name)}
            >
              <Table2 className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              <span className="flex-1 text-sm font-mono text-foreground/70 truncate">
                {table.table_name}
              </span>
              {isPinned && (
                <Pin className="w-2.5 h-2.5 text-blue-400/50 shrink-0" />
              )}
              {table.table_type === 'VIEW' && (
                <span className="px-1 py-0.5 rounded text-sm font-medium bg-violet-500/10 text-violet-400/70 shrink-0">
                  VIEW
                </span>
              )}
            </div>
          );
        })}

        {/* Redis keys */}
        {isRedis && !loading && !error && filteredKeys.length === 0 && redisKeys.length === 0 && (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No keys found
          </p>
        )}

        {isRedis && !loading && !error && filteredKeys.length === 0 && redisKeys.length > 0 && (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No matching keys
          </p>
        )}

        {isRedis && filteredKeys.map((keyInfo) => {
          const isSelected = selectedKey === keyInfo.key;
          return (
            <div
              key={keyInfo.key}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-secondary/40 border border-transparent'
              }`}
              onClick={() => onSelectKey(keyInfo.key)}
            >
              <Key className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              <span className="flex-1 text-sm font-mono text-foreground/70 truncate">
                {keyInfo.key}
              </span>
              <ChevronRight className="w-3 h-3 text-muted-foreground/20 shrink-0" />
            </div>
          );
        })}
      </div>

      {/* Footer: count */}
      {!loading && !error && (
        <div className="px-3 py-2 border-t border-primary/5 text-sm text-muted-foreground/60">
          {isRedis
            ? `${redisKeys.length} key${redisKeys.length !== 1 ? 's' : ''}`
            : `${tables.length} table${tables.length !== 1 ? 's' : ''}`}
        </div>
      )}
    </div>
  );
}
