import { Table2, Pin, Key, ChevronRight, Database } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { TableSearch, SidebarTestConnection } from './TableSearch';
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

/**
 * Rows in this sidebar ARE the primary navigation of the schema browser, so they
 * carry role="button" + tabIndex and must answer the two keys a native button
 * answers. Without this a keyboard user could reach the filter box and the
 * refresh control but never open a table's detail panel.
 */
function activateOnKey(e: React.KeyboardEvent, activate: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    activate();
  }
}

/** Deterministic width variety so the ghosts read as rows, not a barcode. */
const GHOST_BAR_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3'];

/**
 * Cold-load ghost for the schema list — the loading pattern v2 shape
 * (`UnifiedTable`'s `TableGhostRows`, scaled to this sidebar's row geometry).
 *
 * What stood here was `feedback/LoadingSpinner`, which renders `null`: a
 * surface that reported "Loading..." next to a blank 12-unit-tall box while the
 * introspection round-trip ran. Rows here are `px-2.5 py-2` with a 3x3 icon and
 * a single truncated label, and the ghost matches that so nothing shifts when
 * the real rows arrive. `animate-fade-in` behind a staggered >=120ms delay
 * (fill-mode both) keeps a fast fetch from ever painting one, and there is no
 * `animate-pulse` — this is a calm ghost, never a spinner.
 */
function SidebarGhostRows({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-0.5">
        {GHOST_BAR_WIDTHS.concat(GHOST_BAR_WIDTHS).map((w, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-modal border border-transparent animate-fade-in"
            style={{ animationDelay: `${120 + i * 35}ms` }}
          >
            <span className="w-3 h-3 rounded bg-primary/[0.08] shrink-0" />
            <span className={`inline-block h-3 rounded bg-primary/[0.06] ${w}`} />
          </div>
        ))}
      </div>
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
  const { t, tx } = useTranslation();
  const dbt = t.vault.databases;
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
      <TableSearch
        filter={filter}
        onFilterChange={onFilterChange}
        loading={loading}
        isRedis={isRedis}
        isApi={isApi}
        onRefresh={onRefresh}
      />

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {loading && tables.length === 0 && redisKeys.length === 0 && (
          <SidebarGhostRows label={dbt.loading} />
        )}

        {error && (
          <div className="space-y-2">
            <div className="p-2.5 rounded-card bg-red-500/10 border border-red-500/20 typo-body text-red-400 break-words">
              {error}
            </div>
            {credentialId && <SidebarTestConnection credentialId={credentialId} />}
          </div>
        )}

        {/* SQL / API tables */}
        {!isRedis && !loading && !error && filteredTables.length === 0 && tables.length === 0 && (
          <div className="flex flex-col items-center py-8 gap-1">
            <p className="typo-body text-foreground text-center">
              {isApi ? dbt.no_databases_found : dbt.no_tables_found}
            </p>
            {credentialId && <SidebarTestConnection credentialId={credentialId} />}
          </div>
        )}

        {!isRedis && !loading && !error && filteredTables.length === 0 && tables.length > 0 && (
          <p className="typo-body text-foreground text-center py-8">{dbt.no_matching_tables}</p>
        )}

        {!isRedis && filteredTables.map((table) => {
          const isSelected = selectedTable === table.table_name;
          const isPinned = pinnedTableNames.has(table.table_name);
          const Icon = isApi ? Database : Table2;
          const displayName = table.display_label || table.table_name;
          return (
            <div
              key={table.table_name}
              role="button"
              tabIndex={0}
              aria-current={isSelected || undefined}
              className={`focus-ring flex items-center gap-1.5 px-2.5 py-2 rounded-modal cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-secondary/40 border border-transparent'
              }`}
              onClick={() => onSelectTable(table.table_name)}
              onKeyDown={(e) => activateOnKey(e, () => onSelectTable(table.table_name))}
              onContextMenu={(e) => onContextMenu(e, table.table_name)}
            >
              <Icon className="w-3 h-3 text-foreground shrink-0" />
              <span className={`flex-1 typo-code text-foreground truncate ${isApi ? '' : 'font-mono'}`}>
                {displayName}
              </span>
              {isPinned && <Pin className="w-2.5 h-2.5 text-blue-400/50 shrink-0" />}
              {table.table_type === 'VIEW' && (
                <span className="px-1 py-0.5 rounded typo-body font-medium bg-violet-500/10 text-violet-400/70 shrink-0">VIEW</span>
              )}
              {table.table_type === 'DATABASE' && (
                <span className="px-1 py-0.5 rounded typo-body font-medium bg-blue-500/10 text-blue-400/70 shrink-0">DB</span>
              )}
            </div>
          );
        })}

        {/* Redis keys */}
        {isRedis && !loading && !error && filteredKeys.length === 0 && redisKeys.length === 0 && (
          <p className="typo-body text-foreground text-center py-8">{dbt.no_keys_found}</p>
        )}

        {isRedis && !loading && !error && filteredKeys.length === 0 && redisKeys.length > 0 && (
          <p className="typo-body text-foreground text-center py-8">{dbt.no_matching_keys}</p>
        )}

        {isRedis && filteredKeys.map((keyInfo) => {
          const isSelected = selectedKey === keyInfo.key;
          return (
            <div
              key={keyInfo.key}
              role="button"
              tabIndex={0}
              aria-current={isSelected || undefined}
              className={`focus-ring flex items-center gap-1.5 px-2.5 py-2 rounded-modal cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-secondary/40 border border-transparent'
              }`}
              onClick={() => onSelectKey(keyInfo.key)}
              onKeyDown={(e) => activateOnKey(e, () => onSelectKey(keyInfo.key))}
            >
              <Key className="w-3 h-3 text-foreground shrink-0" />
              <span className="flex-1 typo-code font-mono text-foreground truncate">{keyInfo.key}</span>
              <ChevronRight className="w-3 h-3 text-foreground shrink-0" />
            </div>
          );
        })}
      </div>

      {/* Footer: count */}
      {!loading && !error && (
        <div className="px-3 py-2 border-t border-primary/5 typo-body text-foreground">
          {isRedis
            ? tx(redisKeys.length !== 1 ? dbt.key_count_other : dbt.key_count_one, { count: redisKeys.length })
            : isApi
              ? tx(tables.length !== 1 ? dbt.database_count_other : dbt.database_count_one, { count: tables.length })
              : tx(tables.length !== 1 ? dbt.table_count_other : dbt.table_count_one, { count: tables.length })}
        </div>
      )}
    </div>
  );
}
