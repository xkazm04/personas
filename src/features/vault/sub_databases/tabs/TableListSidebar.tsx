import { RefreshCw, Search, Table2, Pin, Key, ChevronRight, Database, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useCredentialHealth } from '@/features/vault/hooks/health/useCredentialHealth';
import type { IntrospectedTable, RedisKeyInfo } from '@/hooks/database/useTableIntrospection';

interface TableListSidebarProps {
  tables: IntrospectedTable[];
  redisKeys: RedisKeyInfo[];
  loading: boolean;
  error: string | null;
  isRedis: boolean;
  /** Notion/Airtable API-based connector. */
  isApi?: boolean;
  filter: string;
  onFilterChange: (v: string) => void;
  selectedTable: string | null;
  selectedKey: string | null;
  pinnedTableNames: Set<string>;
  onSelectTable: (name: string) => void;
  onSelectKey: (key: string) => void;
  onRefresh: () => void;
  onContextMenu: (e: React.MouseEvent, tableName: string) => void;
  credentialId?: string;
}

/** Compact inline test connection for the sidebar empty state. */
function SidebarTestConnection({ credentialId }: { credentialId: string }) {
  const { result, isHealthchecking, checkStored } = useCredentialHealth(credentialId);

  return (
    <div className="flex flex-col items-center gap-2 mt-2">
      <button
        onClick={checkStored}
        disabled={isHealthchecking}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50 transition-colors"
      >
        {isHealthchecking ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Zap className="w-3 h-3" />
        )}
        {isHealthchecking ? 'Testing...' : 'Test Connection'}
      </button>
      {result && !isHealthchecking && (
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs ${
            result.success
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="w-3 h-3 shrink-0" />
          ) : (
            <XCircle className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate max-w-[180px]">{result.message}</span>
        </div>
      )}
    </div>
  );
}

export function TableListSidebar({
  tables,
  redisKeys,
  loading,
  error,
  isRedis,
  isApi = false,
  filter,
  onFilterChange,
  selectedTable,
  selectedKey,
  pinnedTableNames,
  onSelectTable,
  onSelectKey,
  onRefresh,
  onContextMenu,
  credentialId,
}: TableListSidebarProps) {
  const q = filter.trim().toLowerCase();
  const filteredTables = q
    ? tables.filter((t) => {
        const label = t.display_label?.toLowerCase() ?? '';
        return t.table_name.toLowerCase().includes(q) || label.includes(q);
      })
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
              placeholder={isRedis ? 'Filter keys...' : isApi ? 'Filter databases...' : 'Filter tables...'}
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
            <LoadingSpinner className="text-muted-foreground/60" />
            <span className="text-sm text-muted-foreground/60">Loading...</span>
          </div>
        )}

        {error && (
          <div className="space-y-2">
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 break-words">
              {error}
            </div>
            {credentialId && (
              <SidebarTestConnection credentialId={credentialId} />
            )}
          </div>
        )}

        {/* SQL / API tables */}
        {!isRedis && !loading && !error && filteredTables.length === 0 && tables.length === 0 && (
          <div className="flex flex-col items-center py-8 gap-1">
            <p className="text-sm text-muted-foreground/60 text-center">
              {isApi ? 'No databases found' : 'No tables found'}
            </p>
            {credentialId && (
              <SidebarTestConnection credentialId={credentialId} />
            )}
          </div>
        )}

        {!isRedis && !loading && !error && filteredTables.length === 0 && tables.length > 0 && (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No matching tables
          </p>
        )}

        {!isRedis && filteredTables.map((table) => {
          const isSelected = selectedTable === table.table_name;
          const isPinned = pinnedTableNames.has(table.table_name);
          const Icon = isApi ? Database : Table2;
          const displayName = table.display_label || table.table_name;
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
              <Icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              <span className={`flex-1 text-sm text-foreground/70 truncate ${isApi ? '' : 'font-mono'}`}>
                {displayName}
              </span>
              {isPinned && (
                <Pin className="w-2.5 h-2.5 text-blue-400/50 shrink-0" />
              )}
              {table.table_type === 'VIEW' && (
                <span className="px-1 py-0.5 rounded text-sm font-medium bg-violet-500/10 text-violet-400/70 shrink-0">
                  VIEW
                </span>
              )}
              {table.table_type === 'DATABASE' && (
                <span className="px-1 py-0.5 rounded text-sm font-medium bg-blue-500/10 text-blue-400/70 shrink-0">
                  DB
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
            : isApi
              ? `${tables.length} database${tables.length !== 1 ? 's' : ''}`
              : `${tables.length} table${tables.length !== 1 ? 's' : ''}`}
        </div>
      )}
    </div>
  );
}
