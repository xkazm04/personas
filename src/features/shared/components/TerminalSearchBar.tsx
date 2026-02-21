import { useState, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import type { TerminalLineStyle } from '@/lib/utils/terminalColors';

export interface TerminalFilter {
  keyword: string;
  activeTypes: Set<TerminalLineStyle>;
}

const LINE_TYPE_CHIPS: { type: TerminalLineStyle; label: string; color: string; activeColor: string }[] = [
  { type: 'error', label: 'Error', color: 'text-red-400/50 border-red-500/20', activeColor: 'text-red-400 bg-red-500/15 border-red-500/30' },
  { type: 'tool', label: 'Tool', color: 'text-cyan-400/50 border-cyan-500/20', activeColor: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30' },
  { type: 'status', label: 'Status', color: 'text-emerald-400/50 border-emerald-500/20', activeColor: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
  { type: 'text', label: 'Text', color: 'text-foreground/40 border-border/30', activeColor: 'text-foreground/80 bg-foreground/10 border-foreground/20' },
];

const ALL_TYPES = new Set<TerminalLineStyle>(['error', 'tool', 'status', 'text', 'meta', 'summary']);

interface TerminalSearchBarProps {
  filter: TerminalFilter;
  onChange: (filter: TerminalFilter) => void;
}

export function useTerminalFilter() {
  const [filter, setFilter] = useState<TerminalFilter>({ keyword: '', activeTypes: ALL_TYPES });

  const isLineVisible = useCallback(
    (line: string, lineType: TerminalLineStyle): boolean => {
      if (!filter.activeTypes.has(lineType)) return false;
      if (filter.keyword && !line.toLowerCase().includes(filter.keyword.toLowerCase())) return false;
      return true;
    },
    [filter],
  );

  const isFiltering = filter.keyword !== '' || filter.activeTypes.size < ALL_TYPES.size;

  const resetFilter = useCallback(() => {
    setFilter({ keyword: '', activeTypes: ALL_TYPES });
  }, []);

  return { filter, setFilter, isLineVisible, isFiltering, resetFilter };
}

export function TerminalSearchBar({ filter, onChange }: TerminalSearchBarProps) {
  const [expanded, setExpanded] = useState(false);
  const isFiltering = filter.keyword !== '' || filter.activeTypes.size < ALL_TYPES.size;

  const toggleType = (type: TerminalLineStyle) => {
    const next = new Set(filter.activeTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onChange({ ...filter, activeTypes: next });
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground/40 hover:text-foreground/60 transition-colors border-b border-border/10"
      >
        <Search className="w-3 h-3" />
        Search & Filter
        {isFiltering && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
        )}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/15 bg-secondary/20">
      <Search className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
      <input
        type="text"
        value={filter.keyword}
        onChange={(e) => onChange({ ...filter, keyword: e.target.value })}
        placeholder="Search output..."
        autoFocus
        className="flex-1 min-w-0 bg-transparent text-xs text-foreground/80 placeholder-muted-foreground/30 outline-none font-mono"
      />

      <div className="flex items-center gap-1 flex-shrink-0">
        {LINE_TYPE_CHIPS.map(({ type, label, color, activeColor }) => (
          <button
            key={type}
            onClick={() => toggleType(type)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
              filter.activeTypes.has(type) ? activeColor : color
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          onChange({ keyword: '', activeTypes: ALL_TYPES });
          setExpanded(false);
        }}
        className="text-muted-foreground/40 hover:text-foreground/60 transition-colors flex-shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
