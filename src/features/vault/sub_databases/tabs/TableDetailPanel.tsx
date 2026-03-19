import { Table2, Pin, Eye, Key } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { IntrospectedTable, IntrospectedColumn } from '@/hooks/database/useTableIntrospection';

interface TableDetailPanelProps {
  isRedis: boolean;
  selectedTable: string | null;
  selectedKey: string | null;
  keyTypeResult: string | null;
  tables: IntrospectedTable[];
  columns: IntrospectedColumn[];
  columnsLoading: boolean;
  columnsError: string | null;
  isPinned: boolean;
  onPinTable: (tableName: string) => void;
}

export function TableDetailPanel({
  isRedis,
  selectedTable,
  selectedKey,
  keyTypeResult,
  tables,
  columns,
  columnsLoading,
  columnsError,
  isPinned,
  onPinTable,
}: TableDetailPanelProps) {
  return (
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
            {!isPinned && (
              <button
                onClick={() => onPinTable(selectedTable)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-sm font-medium text-blue-400/70 hover:bg-blue-500/10 transition-colors"
                title="Pin this table"
              >
                <Pin className="w-3 h-3" />
                Pin
              </button>
            )}
            {isPinned && (
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
                <LoadingSpinner className="text-muted-foreground/60" />
                <span className="text-sm text-muted-foreground/60">Loading columns...</span>
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
                            <span className="text-muted-foreground/60">yes</span>
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
              <p className="text-sm text-muted-foreground/60 text-center py-8">
                No columns found
              </p>
            )}

            {!columnsLoading && !columnsError && columns.length > 0 && (
              <div className="mt-3 text-sm text-muted-foreground/60">
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
                <LoadingSpinner className="text-muted-foreground/60" />
                <span className="text-sm text-muted-foreground/60">Loading key info...</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground/50">Type:</span>
                  <span className="px-2 py-0.5 rounded text-sm font-mono font-medium bg-amber-500/10 text-amber-400/70">
                    {keyTypeResult}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground/60">
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
          <p className="text-sm text-muted-foreground/60">
            Select a table to view its schema
          </p>
        </div>
      )}

      {isRedis && !selectedKey && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Key className="w-6 h-6 text-muted-foreground/15" />
          <p className="text-sm text-muted-foreground/60">
            Select a key to view its type
          </p>
        </div>
      )}
    </div>
  );
}
