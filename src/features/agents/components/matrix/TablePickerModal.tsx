import { useState, useMemo, useEffect } from 'react';
import { Check, Table2, X, Search } from 'lucide-react';
import { ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { HealthyConnector } from './useHealthyConnectors';
import type { DbSchemaTable } from '@/lib/bindings/DbSchemaTable';

interface TablePickerModalProps {
  isOpen: boolean;
  connectorName: string | null;
  connectors: HealthyConnector[];
  tables: DbSchemaTable[];
  loading: boolean;
  selectedTable: string | null;
  onSelect: (tableName: string | null) => void;
  onClose: () => void;
}

export function TablePickerModal({
  isOpen, connectorName, connectors, tables, loading, selectedTable, onSelect, onClose,
}: TablePickerModalProps) {
  const [search, setSearch] = useState('');
  const conn = connectorName ? connectors.find((c) => c.name === connectorName) : null;

  const filtered = useMemo(() => {
    if (!search) return tables;
    const q = search.toLowerCase();
    return tables.filter((t) =>
      t.table_name.toLowerCase().includes(q) || (t.display_label?.toLowerCase().includes(q)),
    );
  }, [tables, search]);

  useEffect(() => { if (isOpen) setSearch(''); }, [isOpen]);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="table-picker-title" size="md">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-primary/10">
        <div className="flex items-center gap-3">
          {conn && (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10">
              <ConnectorIcon meta={conn.meta} size="w-4 h-4" />
            </div>
          )}
          <div>
            <h2 id="table-picker-title" className="text-sm font-semibold text-foreground/90">
              Select Table
            </h2>
            <p className="text-xs text-muted-foreground/50">{conn?.meta.label ?? connectorName}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      {tables.length > 5 && (
        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/15 bg-secondary/20">
            <Search className="w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tables..."
              className="flex-1 bg-transparent text-sm text-foreground/80 placeholder:text-muted-foreground/30 outline-none"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Table list */}
      <div className="px-5 py-3 max-h-[50vh] overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground/40">Loading tables...</div>
        ) : tables.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground/40">No tables found for this connector</div>
        ) : (
          <div className="space-y-0.5">
            {selectedTable && (
              <button
                type="button"
                onClick={() => onSelect(null)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-muted-foreground/50 hover:bg-secondary/30 transition-colors italic"
              >
                Clear selection
              </button>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t.table_name)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2.5 ${
                  selectedTable === t.table_name
                    ? 'bg-primary/8 text-primary font-medium'
                    : 'text-foreground/70 hover:bg-secondary/30'
                }`}
              >
                <Table2 className="w-3.5 h-3.5 flex-shrink-0 text-blue-400/60" />
                <span className="truncate">{t.display_label || t.table_name}</span>
                {selectedTable === t.table_name && (
                  <Check className="w-3.5 h-3.5 ml-auto flex-shrink-0 text-primary" />
                )}
              </button>
            ))}
            {filtered.length === 0 && search && (
              <div className="py-4 text-center text-xs text-muted-foreground/40">No tables matching &quot;{search}&quot;</div>
            )}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
