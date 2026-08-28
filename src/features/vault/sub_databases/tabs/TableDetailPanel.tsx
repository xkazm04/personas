import { useEffect } from 'react';
import { Table2, Pin, Eye, Key, Database } from 'lucide-react';
import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';
import { useTranslation } from '@/i18n/useTranslation';
import { ColumnList } from './ColumnList';
import type { IntrospectedTable, IntrospectedColumn } from '@/hooks/database/useTableIntrospection';
import type { ConnectorFamily } from '@/features/vault/sub_databases/introspectionQueries';

interface TableDetailPanelProps {
  isRedis: boolean;
  /** Notion/Airtable API-based connector. */
  isApi?: boolean;
  selectedTable: string | null;
  selectedKey: string | null;
  keyTypeResult: string | null;
  tables: IntrospectedTable[];
  columns: IntrospectedColumn[];
  columnsLoading: boolean;
  columnsError: string | null;
  isPinned: boolean;
  onPinTable: (tableName: string) => void;
  family?: ConnectorFamily;
}

export function TableDetailPanel({
  isRedis,
  isApi = false,
  selectedTable,
  selectedKey,
  keyTypeResult,
  tables,
  columns,
  columnsLoading,
  columnsError,
  isPinned,
  onPinTable,
  family,
}: TableDetailPanelProps) {
  const { t } = useTranslation();
  const dbt = t.vault.databases;
  const tableEntry = selectedTable ? tables.find((t) => t.table_name === selectedTable) : null;
  const displayName = tableEntry?.display_label || selectedTable;
  const HeaderIcon = isApi ? Database : Table2;

  // The key-info ghost is aria-hidden, so its state is announced through the
  // app-wide live region instead of a local one born together with its own text
  // (census `live-region-born-with-its-message`).
  const keyInfoLoading = isRedis && selectedKey !== null && keyTypeResult === null;
  useEffect(() => {
    if (keyInfoLoading) announceImperative(dbt.loading_key_info);
  }, [keyInfoLoading, dbt.loading_key_info]);

  const columnLabel = isApi ? dbt.col_property : dbt.col_column;
  const typeLabel = isApi
    ? (family === 'notion' ? dbt.col_notion_type : family === 'airtable' ? dbt.col_field_type : dbt.col_type)
    : dbt.col_type;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* SQL / API table detail */}
      {!isRedis && selectedTable && (
        <>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
            <HeaderIcon className="w-4 h-4 text-blue-400/60" />
            <span className={`typo-code font-medium text-foreground flex-1 ${isApi ? '' : 'font-mono'}`}>
              {displayName}
            </span>
            {tables.find((t) => t.table_name === selectedTable)?.table_type === 'VIEW' && (
              <span className="px-1.5 py-0.5 rounded typo-body font-medium bg-violet-500/10 text-violet-400/70">VIEW</span>
            )}
            {!isPinned && (
              <button
                type="button"
                onClick={() => onPinTable(selectedTable)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-modal typo-body font-medium text-blue-400/70 hover:bg-blue-500/10 transition-colors"
                title={dbt.pin_table}
              >
                <Pin className="w-3 h-3" />
                {dbt.pin}
              </button>
            )}
            {isPinned && (
              <span className="flex items-center gap-1 px-2.5 py-1 typo-body text-blue-400/50">
                <Pin className="w-3 h-3" />
                {dbt.pinned}
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <ColumnList
              columns={columns}
              columnsLoading={columnsLoading}
              columnsError={columnsError}
              isApi={isApi}
              columnLabel={columnLabel}
              typeLabel={typeLabel}
            />
          </div>
        </>
      )}

      {/* Redis key detail */}
      {isRedis && selectedKey && (
        <>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
            <Key className="w-4 h-4 text-amber-400/60" />
            <span className="typo-code font-mono font-medium text-foreground flex-1 truncate">{selectedKey}</span>
          </div>
          <div className="p-4">
            {keyTypeResult === null ? (
              /* Cold load for the key detail — a ghost matched to the settled block
                 below it (label + type pill on one row, hint line under), not the
                 old `<LoadingSpinner/>` beside "Loading key info…", which rendered
                 `null` and left a bare sentence where a shape belonged.
                 `animate-fade-in` is fill-mode `both`, so the ≥120ms stagger means a
                 fast TYPE lookup never paints a ghost. No `animate-pulse`.
                 Silent to assistive tech on purpose — the announcement goes through
                 the app-wide AriaLiveProvider above, because a local `role="status"`
                 mounted together with its own text is never announced at all. */
              <div aria-hidden="true" className="space-y-3">
                <div className="flex items-center gap-3 animate-fade-in" style={{ animationDelay: '120ms' }}>
                  <span className="h-3.5 w-16 rounded bg-primary/[0.06]" />
                  <span className="h-5 w-20 rounded bg-primary/[0.06]" />
                </div>
                <span className="block h-3.5 w-3/5 rounded bg-primary/[0.06] animate-fade-in" style={{ animationDelay: '155ms' }} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="typo-body text-foreground">{dbt.type_label}</span>
                  <span className="px-2 py-0.5 rounded typo-code font-mono font-medium bg-amber-500/10 text-amber-400/70">
                    {keyTypeResult}
                  </span>
                </div>
                <p className="typo-body text-foreground">
                  {dbt.use_console_hint}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty state */}
      {!isRedis && !selectedTable && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          {isApi ? (
            <Database className="w-6 h-6 text-foreground" />
          ) : (
            <Eye className="w-6 h-6 text-foreground" />
          )}
          <p className="typo-body text-foreground">
            {isApi ? dbt.select_db_hint : dbt.select_table_hint}
          </p>
        </div>
      )}

      {isRedis && !selectedKey && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Key className="w-6 h-6 text-foreground" />
          <p className="typo-body text-foreground">{dbt.select_key_hint}</p>
        </div>
      )}
    </div>
  );
}
