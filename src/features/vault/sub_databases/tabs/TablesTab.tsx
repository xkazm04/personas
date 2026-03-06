import { useState, useCallback } from 'react';
import { RefreshCw, Search, Loader2, Table2, Eye, Pin, Key, ChevronRight } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { getSelectAllQuery } from '../introspectionQueries';
import { TableContextMenu, type TableContextMenuState } from './TableContextMenu';
import { useTableIntrospection, getCachedColumns } from '@/hooks/database/useTableIntrospection';

interface TablesTabProps {
  credentialId: string;
  serviceType: string;
}

export function TablesTab({ credentialId, serviceType }: TablesTabProps) {
  const executeDbQuery = usePersonaStore((s) => s.executeDbQuery);
  const pinnedTables = usePersonaStore((s) => s.dbSchemaTables).filter((t) => t.credential_id === credentialId);
  const createTable = usePersonaStore((s) => s.createDbSchemaTable);

  const {
    tables,
    redisKeys,
    loading,
    error,
    isRedis,
    family,
    fetchTables,
    fetchColumns,
    columns,
    columnsLoading,
    columnsError,
    clearCache,
  } = useTableIntrospection({ credentialId, serviceType });

  // Selection state (TablesTab-specific — not needed by the reusable hook)
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyTypeResult, setKeyTypeResult] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<TableContextMenuState | null>(null);
  const [filter, setFilter] = useState('');

  // Fetch Redis key type
  const fetchKeyType = useCallback(async (key: string) => {
    try {
      const result = await executeDbQuery(credentialId, `TYPE ${key}`);
      const val = result.rows[0]?.[0];
      setKeyTypeResult(val != null ? String(val) : 'unknown');
    } catch {
      setKeyTypeResult('error');
    }
  }, [credentialId, executeDbQuery]);

  // Handle table selection
  const handleSelectTable = useCallback((tableName: string) => {
    setSelectedTable(tableName);
    fetchColumns(tableName);
  }, [fetchColumns]);

  // Handle Redis key selection
  const handleSelectKey = useCallback((key: string) => {
    setSelectedKey(key);
    setKeyTypeResult(null);
    fetchKeyType(key);
  }, [fetchKeyType]);

  // Handle refresh — clears module-level cache and re-fetches
  const handleRefresh = useCallback(() => {
    clearCache();
    setSelectedTable(null);
    setSelectedKey(null);
    setKeyTypeResult(null);
    fetchTables(true);
  }, [clearCache, fetchTables]);

  // Pin table with auto-populated column hints
  const handlePinTable = useCallback(async (tableName: string) => {
    const cached = getCachedColumns(credentialId, tableName);
    const hints = cached
      ? JSON.stringify(cached.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
          default: c.column_default,
        })))
      : null;
    const alreadyPinned = pinnedTables.some((t) => t.table_name === tableName);
    if (!alreadyPinned) {
      await createTable(credentialId, tableName, null, hints);
    }
  }, [credentialId, pinnedTables, createTable]);

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, tableName: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tableName });
  }, []);

  const handleCopyQuery = useCallback((tableName: string) => {
    const query = getSelectAllQuery(serviceType, tableName);
    navigator.clipboard.writeText(query);
  }, [serviceType]);

  const handleCopyName = useCallback((tableName: string) => {
    navigator.clipboard.writeText(tableName);
  }, []);

  // Unsupported connector
  if (family === 'unsupported') {
    return (
      <div className="flex items-center justify-center h-full min-h-[300px]">
        <p className="text-sm text-muted-foreground/50">
          Table introspection is not available for this connector type.
        </p>
      </div>
    );
  }

  // Filter tables/keys
  const q = filter.trim().toLowerCase();
  const filteredTables = q
    ? tables.filter((t) => t.table_name.toLowerCase().includes(q))
    : tables;
  const filteredKeys = q
    ? redisKeys.filter((k) => k.key.toLowerCase().includes(q))
    : redisKeys;

  return (
    <div className="flex h-full min-h-[500px]">
      {/* Left sidebar: table/key list */}
      <div className="w-72 border-r border-primary/10 flex flex-col shrink-0">
        {/* Toolbar */}
        <div className="p-3 border-b border-primary/5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/30" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={isRedis ? 'Filter keys...' : 'Filter tables...'}
                className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 transition-colors"
              />
            </div>
            <button
              onClick={handleRefresh}
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
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground/40">Loading...</span>
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 break-words">
              {error}
            </div>
          )}

          {/* SQL tables */}
          {!isRedis && !loading && !error && filteredTables.length === 0 && tables.length === 0 && (
            <p className="text-sm text-muted-foreground/40 text-center py-8">
              No tables found
            </p>
          )}

          {!isRedis && !loading && !error && filteredTables.length === 0 && tables.length > 0 && (
            <p className="text-sm text-muted-foreground/40 text-center py-8">
              No matching tables
            </p>
          )}

          {!isRedis && filteredTables.map((table) => {
            const isSelected = selectedTable === table.table_name;
            const isPinned = pinnedTables.some((p) => p.table_name === table.table_name);
            return (
              <div
                key={table.table_name}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-secondary/40 border border-transparent'
                }`}
                onClick={() => handleSelectTable(table.table_name)}
                onContextMenu={(e) => handleContextMenu(e, table.table_name)}
              >
                <Table2 className="w-3 h-3 text-muted-foreground/30 shrink-0" />
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
            <p className="text-sm text-muted-foreground/40 text-center py-8">
              No keys found
            </p>
          )}

          {isRedis && !loading && !error && filteredKeys.length === 0 && redisKeys.length > 0 && (
            <p className="text-sm text-muted-foreground/40 text-center py-8">
              No matching keys
            </p>
          )}

          {isRedis && filteredKeys.map((keyInfo) => {
            const isSelected = selectedKey === keyInfo.key;
            return (
              <div
                key={keyInfo.key}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-secondary/40 border border-transparent'
                }`}
                onClick={() => handleSelectKey(keyInfo.key)}
              >
                <Key className="w-3 h-3 text-muted-foreground/30 shrink-0" />
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
          <div className="px-3 py-2 border-t border-primary/5 text-sm text-muted-foreground/30">
            {isRedis
              ? `${redisKeys.length} key${redisKeys.length !== 1 ? 's' : ''}`
              : `${tables.length} table${tables.length !== 1 ? 's' : ''}`}
          </div>
        )}
      </div>

      {/* Right panel: column details */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* SQL table detail */}
        {!isRedis && selectedTable && (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
              <Table2 className="w-4 h-4 text-blue-400/60" />
              <span className="text-sm font-mono font-medium text-foreground/80 flex-1">
                {selectedTable}
              </span>
              {tables.find((t) => t.table_name === selectedTable)?.table_type === 'VIEW' && (
                <span className="px-1.5 py-0.5 rounded text-sm font-medium bg-violet-500/10 text-violet-400/70">
                  VIEW
                </span>
              )}
              {!pinnedTables.some((p) => p.table_name === selectedTable) && (
                <button
                  onClick={() => handlePinTable(selectedTable)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-medium text-blue-400/70 hover:bg-blue-500/10 transition-colors"
                  title="Pin this table"
                >
                  <Pin className="w-3 h-3" />
                  Pin
                </button>
              )}
              {pinnedTables.some((p) => p.table_name === selectedTable) && (
                <span className="flex items-center gap-1 px-2.5 py-1 text-sm text-blue-400/50">
                  <Pin className="w-3 h-3" />
                  Pinned
                </span>
              )}
            </div>

            {/* Columns */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {columnsLoading && (
                <div className="flex items-center gap-2 py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
                  <span className="text-sm text-muted-foreground/40">Loading columns...</span>
                </div>
              )}

              {columnsError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 break-words">
                  {columnsError}
                </div>
              )}

              {!columnsLoading && !columnsError && columns.length > 0 && (
                <div className="rounded-lg border border-primary/10 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-secondary/40 border-b border-primary/10">
                        <th className="px-3 py-2 text-left font-semibold text-foreground/70 w-1/3">Column</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground/70 w-1/4">Type</th>
                        <th className="px-3 py-2 text-center font-semibold text-foreground/70 w-20">Nullable</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground/70">Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((col, i) => (
                        <tr
                          key={col.column_name}
                          className={`border-b border-primary/5 ${i % 2 === 0 ? 'bg-transparent' : 'bg-secondary/10'}`}
                        >
                          <td className="px-3 py-1.5 font-mono text-foreground/80">
                            {col.column_name}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-blue-400/70">
                            {col.data_type}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {col.is_nullable === 'YES' ? (
                              <span className="text-muted-foreground/30">yes</span>
                            ) : (
                              <span className="text-amber-400/70 font-medium">NOT NULL</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground/50 truncate max-w-[200px]" title={col.column_default ?? ''}>
                            {col.column_default ?? (
                              <span className="text-muted-foreground/20">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!columnsLoading && !columnsError && columns.length === 0 && (
                <p className="text-sm text-muted-foreground/40 text-center py-8">
                  No columns found
                </p>
              )}

              {!columnsLoading && !columnsError && columns.length > 0 && (
                <div className="mt-3 text-sm text-muted-foreground/30">
                  {columns.length} column{columns.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </>
        )}

        {/* Redis key detail */}
        {isRedis && selectedKey && (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
              <Key className="w-4 h-4 text-amber-400/60" />
              <span className="text-sm font-mono font-medium text-foreground/80 flex-1 truncate">
                {selectedKey}
              </span>
            </div>
            <div className="p-4">
              {keyTypeResult === null ? (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
                  <span className="text-sm text-muted-foreground/40">Loading key info...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground/50">Type:</span>
                    <span className="px-2 py-0.5 rounded text-sm font-mono font-medium bg-amber-500/10 text-amber-400/70">
                      {keyTypeResult}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground/30">
                    Use the Console tab to inspect this key's value.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty state */}
        {!isRedis && !selectedTable && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Eye className="w-6 h-6 text-muted-foreground/15" />
            <p className="text-sm text-muted-foreground/30">
              Select a table to view its schema
            </p>
          </div>
        )}

        {isRedis && !selectedKey && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Key className="w-6 h-6 text-muted-foreground/15" />
            <p className="text-sm text-muted-foreground/30">
              Select a key to view its type
            </p>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <TableContextMenu
          menu={contextMenu}
          onCopyQuery={handleCopyQuery}
          onCopyName={handleCopyName}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
