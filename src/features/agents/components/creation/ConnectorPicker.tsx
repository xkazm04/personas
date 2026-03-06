import { useState, useMemo } from 'react';
import { Search, Plug } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';

interface ConnectorPickerProps {
  selected: string[];
  onToggle: (name: string) => void;
}

export function ConnectorPicker({ selected, onToggle }: ConnectorPickerProps) {
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = connectorDefinitions.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      );
    });

    const groups: Record<string, typeof filtered> = {};
    for (const c of filtered) {
      const cat = c.category || 'other';
      (groups[cat] ??= []).push(c);
    }

    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [connectorDefinitions, search]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  if (connectorDefinitions.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground/50">
        <Plug className="w-4 h-4 mx-auto mb-1.5 opacity-50" />
        No connectors available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search connectors..."
          className="w-full pl-8 pr-3 py-1.5 bg-secondary/40 border border-primary/10 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {/* Selected count */}
      {selected.length > 0 && (
        <p className="text-sm text-primary/70">
          {selected.length} selected
        </p>
      )}

      {/* Grouped grid */}
      <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
        {grouped.map(([category, connectors]) => (
          <div key={category}>
            <p className="text-sm font-medium text-muted-foreground/50 uppercase tracking-wider mb-1.5">
              {category}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {connectors.map((c) => {
                const meta = getConnectorMeta(c.name);
                const active = selectedSet.has(c.name);
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => onToggle(c.name)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 text-sm rounded-lg border transition-all ${
                      active
                        ? 'bg-primary/10 border-primary/25 text-foreground/90 ring-1 ring-primary/20'
                        : 'bg-secondary/20 border-primary/8 text-muted-foreground/60 hover:bg-secondary/40 hover:text-foreground/75'
                    }`}
                  >
                    <ConnectorIcon meta={meta} size="w-3 h-3" />
                    <span className="truncate max-w-[120px]">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground/40 text-center py-2">No connectors match "{search}"</p>
        )}
      </div>
    </div>
  );
}
