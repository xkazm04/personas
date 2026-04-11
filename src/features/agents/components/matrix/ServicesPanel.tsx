import { useState, useMemo, useEffect } from 'react';
import { Check, Table2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { HealthyConnector } from './useHealthyConnectors';
import { listDbSchemaTables } from '@/api/vault/database/dbSchema';
import type { DbSchemaTable } from '@/lib/bindings/DbSchemaTable';
import { TablePickerModal } from './TablePickerModal';

const DATABASE_CATEGORIES = new Set(['database', 'spreadsheet']);

interface ServicesPanelProps {
  connectors: HealthyConnector[];
  selectedConnectors: string[];
  onToggle: (name: string) => void;
  connectorTables: Record<string, string>;
  onTableSelect: (connectorName: string, tableName: string | null) => void;
}

export function ServicesPanel({
  connectors,
  selectedConnectors,
  onToggle,
  connectorTables,
  onTableSelect,
}: ServicesPanelProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState('all');
  const [tablePopoverFor, setTablePopoverFor] = useState<string | null>(null);
  const [tables, setTables] = useState<DbSchemaTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);

  useEffect(() => {
    if (!tablePopoverFor) return;
    const conn = connectors.find((c) => c.name === tablePopoverFor);
    if (!conn) return;
    setTablesLoading(true);
    listDbSchemaTables(conn.credentialId)
      .then(setTables)
      .catch(() => setTables([]))
      .finally(() => setTablesLoading(false));
  }, [tablePopoverFor, connectors]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const c of connectors) {
      if (c.category) cats.add(c.category);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [connectors]);

  const filtered = useMemo(() => {
    const list = activeCategory === 'all'
      ? connectors
      : connectors.filter((c) => c.category === activeCategory);
    return [...list].sort((a, b) => a.meta.label.localeCompare(b.meta.label));
  }, [connectors, activeCategory]);

  if (connectors.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/40 px-1 py-2">
        {t.agents.services_panel.no_connectors}
      </p>
    );
  }

  return (
    <div className="space-y-3 px-1">
      {/* Category filter strip */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
            activeCategory === 'all'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground/40 hover:text-muted-foreground/60'
          }`}
        >
          {t.common.all}
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
              activeCategory === cat
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground/40 hover:text-muted-foreground/60'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Connector grid */}
      <div className="flex flex-wrap gap-2.5">
        {filtered.map((c) => {
          const isSelected = selectedConnectors.includes(c.name);
          const isDbType = DATABASE_CATEGORIES.has(c.category);
          const selectedTable = connectorTables[c.name];
          return (
            <div key={c.name} className="relative">
              <button
                type="button"
                onClick={() => onToggle(c.name)}
                className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-xl transition-all duration-200 ${
                  isSelected
                    ? 'bg-primary/10 border border-primary/25 shadow-elevation-1 shadow-primary/10'
                    : 'bg-secondary/10 border border-transparent hover:border-primary/15 hover:bg-secondary/20'
                }`}
                style={{ width: 100, height: 75 }}
              >
                {isSelected && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shadow-elevation-1 animate-fade-slide-in">
                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  </div>
                )}
                <div className={`w-7 h-7 flex items-center justify-center transition-all duration-200 ${
                  isSelected ? 'scale-110' : 'group-hover:scale-105'
                }`}>
                  <ConnectorIcon meta={c.meta} size="w-6 h-6" />
                </div>
                <span className={`text-[10px] font-medium truncate max-w-[88px] text-center leading-tight transition-colors ${
                  isSelected ? 'text-foreground/80' : 'text-muted-foreground/50'
                }`}>
                  {selectedTable ? selectedTable : c.meta.label}
                </span>
              </button>

              {isDbType && isSelected && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setTablePopoverFor(c.name); }}
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center hover:bg-blue-500/30 transition-colors"
                  title={t.agents.services_panel.select_table}
                >
                  <Table2 className="w-2.5 h-2.5 text-blue-400" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <TablePickerModal
        isOpen={!!tablePopoverFor}
        connectorName={tablePopoverFor}
        connectors={connectors}
        tables={tables}
        loading={tablesLoading}
        selectedTable={tablePopoverFor ? connectorTables[tablePopoverFor] ?? null : null}
        onSelect={(tableName) => { if (tablePopoverFor) { onTableSelect(tablePopoverFor, tableName); setTablePopoverFor(null); } }}
        onClose={() => setTablePopoverFor(null)}
      />
    </div>
  );
}
