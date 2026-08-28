import { Table2, Pin, Eye, Key, Database } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ColumnList } from './ColumnList';
import type { IntrospectedTable, IntrospectedColumn } from '@/hooks/database/useTableIntrospection';
import type { ConnectorFamily } from '@/features/vault/sub_databases/introspectionQueries';

/**
 * Cold-load ghost for the Redis key-detail pane.
 *
 * `feedback/LoadingSpinner` renders `null`, so selecting a key used to paint a
 * bare "Loading key info..." label with an empty gap beside it and then jump to
 * a two-row layout. The permanent chrome — the "Type" label — stays put and the
 * ghost only stands in for the value badge and the hint line, so the settled
 * state lands in exactly the same place.
 */
function KeyInfoGhost({ label, typeLabel }: { label: string; typeLabel: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-3">
        <span className="typo-body text-foreground">{typeLabel}</span>
        <span
          aria-hidden="true"
          className="inline-block h-4 w-16 rounded bg-primary/[0.06] animate-fade-in"
          style={{ animationDelay: '120ms' }}
        />
      </div>
      <span
        aria-hidden="true"
        className="inline-block h-3 w-2/3 rounded bg-primary/[0.06] animate-fade-in"
        style={{ animationDelay: '155ms' }}
      />
    </div>
  );
}

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
              <KeyInfoGhost label={dbt.loading_key_info} typeLabel={dbt.type_label} />
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
