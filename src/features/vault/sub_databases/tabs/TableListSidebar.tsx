import { useEffect } from 'react';
import { Table2, Pin, Key, ChevronRight, Database } from 'lucide-react';
import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';
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

/** Deterministic ghost-bar width variety so ghosts read as rows, not a barcode. */
const GHOST_BAR_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3'];

/**
 * Cold load for the table list — a calm ghost matched to the real row geometry
 * (`px-2.5 py-2 rounded-modal`, icon slot + label), UNDER the permanent search
 * chrome, per docs/design/overview-loading.md.
 *
 * What this replaced was `<LoadingSpinner/>` beside a centred "Loading…". That
 * component renders `null`, so the sidebar painted one bare sentence floating in
 * an otherwise empty 288px column and then relaid out entirely when rows arrived.
 *
 * `animate-fade-in` carries fill-mode `both`, so the staggered ≥120ms delay keeps
 * these invisible until then and a fast introspection never paints a ghost at all.
 * No `animate-pulse`.
 *
 * Deliberately silent to assistive tech: the loading state is announced through
 * the app-wide `AriaLiveProvider` by the caller. A local `role="status"` here
 * would be mounted in the same commit as its own text and therefore never
 * announced (docs/concepts/golden-paths/screen-reader-announcements.md). The
 * census rule for that condition cannot reach this site — it keys on a live
 * region lexically adjacent to a conditional, and this one is a component
 * boundary away — which is a limit of the proxy, not an exemption on the merits.
 */
function TableListGhost() {
  return (
    <div aria-hidden="true" className="space-y-0.5">
      {Array.from({ length: 7 }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-modal border border-transparent animate-fade-in"
          style={{ animationDelay: `${120 + r * 35}ms` }}
        >
          <span className="w-4 h-4 rounded bg-primary/[0.06] shrink-0" />
          <span className={`h-3.5 rounded bg-primary/[0.06] ${GHOST_BAR_WIDTHS[r % GHOST_BAR_WIDTHS.length]}`} />
        </div>
      ))}
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

  // Announce the cold load through the app-wide, always-mounted live region —
  // see the note on TableListGhost for why a local one cannot work here.
  const isColdLoad = loading && tables.length === 0 && redisKeys.length === 0;
  useEffect(() => {
    if (isColdLoad) announceImperative(dbt.loading);
  }, [isColdLoad, dbt.loading]);

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

  // The footer used to report `tables.length` / `redisKeys.length` — the
  // UNFILTERED totals — while the list right above it rendered the filtered
  // arrays, so narrowing 50 tables to 3 still read "50 tables". Only the
  // zero-match case was handled; every non-empty filter lied.
  const shownCount = isRedis ? filteredKeys.length : filteredTables.length;
  const totalCount = isRedis ? redisKeys.length : tables.length;
  const totalLabel = isRedis
    ? tx(totalCount !== 1 ? dbt.key_count_other : dbt.key_count_one, { count: totalCount })
    : isApi
      ? tx(totalCount !== 1 ? dbt.database_count_other : dbt.database_count_one, { count: totalCount })
      : tx(totalCount !== 1 ? dbt.table_count_other : dbt.table_count_one, { count: totalCount });

  return (
    // Was a flat `w-72`. In a split-screen or small-laptop window that fixed
    // 288px left the detail panel and results grid squeezed to nothing while
    // the sidebar kept every pixel; the list is legible at 224px, so it gives
    // ground first and only takes the full width once there is room for both.
    <div className="w-56 xl:w-72 border-r border-primary/10 flex flex-col shrink-0">
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
        {isColdLoad && <TableListGhost />}

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
        <div data-testid="db-table-list-count" className="px-3 py-2 border-t border-primary/5 typo-body text-foreground">
          {shownCount === totalCount
            ? totalLabel
            : tx(dbt.filtered_count, { matched: shownCount, total: totalLabel })}
        </div>
      )}
    </div>
  );
}
