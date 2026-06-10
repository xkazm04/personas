/**
 * ConnectorTableScopeRow — one row in the connector picker's "Database tables"
 * scope panel. For a single selected database connector, lets the user keep
 * ALL tables (the default) or narrow the persona to a specific subset.
 *
 * Scope semantics (shared with QuickConfigState.connectorTables):
 *   selected = []  ⇒  ALL tables (no filter, no scope note emitted)
 *   selected = [..] ⇒ restrict the persona to exactly those tables
 *
 * The empty-vs-all ambiguity (an empty array means "all", not "none") is
 * resolved with a local `picking` flag: while the user is choosing specific
 * tables the checklist stays open even before they've ticked one, and ticking
 * every table normalises back to "all" ([]).
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useTableIntrospection } from '@/hooks/database/useTableIntrospection';
import type { HealthyConnector } from '@/features/agents/shared/quickConfig/useHealthyConnectors';
import { ComposerBrandIcon } from './ComposerBrandIcon';

interface ConnectorTableScopeRowProps {
  connector: HealthyConnector;
  /** Currently scoped tables for this connector ([] = all). */
  selected: string[];
  onChange: (next: string[]) => void;
}

export function ConnectorTableScopeRow({ connector, selected, onChange }: ConnectorTableScopeRowProps) {
  const { t, tx } = useTranslation();
  const { tables, loading, error, fetchTables } = useTableIntrospection({
    credentialId: connector.credentialId,
    serviceType: connector.name,
  });
  const meta = connector.meta;

  // `picking` = the user has opened the checklist to narrow tables. Seeded from
  // an existing subset so re-opening the picker reflects a saved scope.
  const [picking, setPicking] = useState(selected.length > 0);

  const tableNames = useMemo(() => tables.map((tb) => tb.table_name), [tables]);

  // Fetch on first reveal (the hook caches per credential across opens).
  useEffect(() => {
    if (picking) void fetchTables();
  }, [picking, fetchTables]);

  const isAll = !picking;

  const setAll = (all: boolean) => {
    if (all) {
      onChange([]);
      setPicking(false);
    } else {
      setPicking(true);
      void fetchTables();
    }
  };

  const isTableOn = (name: string) => selected.length === 0 || selected.includes(name);

  const toggleTable = (name: string) => {
    const cur = selected.length === 0 ? [...tableNames] : selected;
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    // Ticking every table is the same as "all" — normalise to [] so no
    // redundant scope note is emitted.
    if (tableNames.length > 0 && next.length === tableNames.length) {
      onChange([]);
      setPicking(false);
      return;
    }
    onChange(next);
  };

  return (
    <div className="rounded-card border border-card-border/50 bg-secondary/15 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div
          className="shrink-0 w-7 h-7 rounded-interactive flex items-center justify-center overflow-hidden"
          style={{ background: `${meta.color}26` }}
        >
          {meta.iconUrl ? (
            <ComposerBrandIcon iconUrl={meta.iconUrl} color={meta.color} size={16} />
          ) : null}
        </div>
        <span className="flex-1 min-w-0 truncate typo-body text-foreground font-medium">{meta.label}</span>
        {/* All-tables toggle */}
        <button
          type="button"
          onClick={() => setAll(!isAll)}
          role="checkbox"
          aria-checked={isAll}
          className="inline-flex items-center gap-1.5 typo-caption text-foreground cursor-pointer"
        >
          <span
            className={`w-4 h-4 rounded-[5px] border flex items-center justify-center transition-colors ${
              isAll ? 'bg-primary border-primary' : 'border-card-border'
            }`}
          >
            {isAll && <Check className="w-3 h-3 text-foreground" strokeWidth={3} />}
          </span>
          {t.agents.glyph_db_scope_all}
        </button>
      </div>

      {!isAll && (
        <div className="mt-2 pl-9">
          {loading ? (
            <span role="status" className="typo-caption text-foreground">
              {t.agents.glyph_db_scope_loading}
            </span>
          ) : error ? (
            <button
              type="button"
              onClick={() => void fetchTables(true)}
              className="inline-flex items-center gap-1.5 typo-caption text-status-error cursor-pointer hover:underline"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              {t.agents.glyph_db_scope_error}
              <RefreshCw className="w-3 h-3" />
            </button>
          ) : tableNames.length === 0 ? (
            <span className="typo-caption text-foreground italic">{t.agents.glyph_db_scope_empty}</span>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {tables.map((tb) => {
                  const on = isTableOn(tb.table_name);
                  return (
                    <button
                      key={tb.table_name}
                      type="button"
                      onClick={() => toggleTable(tb.table_name)}
                      role="checkbox"
                      aria-checked={on}
                      title={tb.display_label ?? tb.table_name}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${
                        on
                          ? 'border-primary/50 bg-primary/15 text-foreground'
                          : 'border-card-border/50 text-foreground hover:bg-foreground/5'
                      }`}
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center ${
                          on ? 'bg-primary border-primary' : 'border-card-border'
                        }`}
                      >
                        {on && <Check className="w-2.5 h-2.5 text-foreground" strokeWidth={3} />}
                      </span>
                      {tb.display_label ?? tb.table_name}
                    </button>
                  );
                })}
              </div>
              <span className="mt-1.5 block typo-caption text-foreground">
                {tx(t.agents.glyph_db_scope_selected, {
                  count: selected.length === 0 ? tableNames.length : selected.length,
                  total: tableNames.length,
                })}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
