import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Search, Filter, ChevronDown, CheckCircle2 } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useViewportClampAbsolute } from '@/hooks/utility/interaction/useViewportClamp';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { highlightMatch } from '@/lib/ui/highlightMatch';
import type { ConnectorWithCount } from '@/api/overview/reviews';

export function ConnectorFilterDropdown({
  availableConnectors,
  connectorFilter,
  setConnectorFilter,
}: {
  availableConnectors: ConnectorWithCount[];
  connectorFilter: string[];
  setConnectorFilter: (connectors: string[]) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useClickOutside(dropdownRef, isOpen, () => setIsOpen(false));
  const clampStyle = useViewportClampAbsolute(popupRef, isOpen);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setDropdownSearch('');
    }
  }, [isOpen]);

  const toggleConnector = (name: string) => {
    if (connectorFilter.includes(name)) {
      setConnectorFilter(connectorFilter.filter((c) => c !== name));
    } else {
      setConnectorFilter([...connectorFilter, name]);
    }
  };

  const sorted = useMemo(() =>
    [...availableConnectors].sort((a, b) => {
      const la = getConnectorMeta(a.name).label;
      const lb = getConnectorMeta(b.name).label;
      return la.localeCompare(lb);
    }),
    [availableConnectors],
  );

  const debouncedSearch = useDebounce(dropdownSearch, 150);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) => {
      const meta = getConnectorMeta(item.name);
      return meta.label.toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
    });
  }, [sorted, debouncedSearch]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 text-sm rounded-modal border border-primary/15 hover:bg-secondary/50 text-foreground transition-colors flex items-center gap-1.5"
      >
        <Filter className="w-3.5 h-3.5" />
        {t.templates.search.connectors_label}
        {connectorFilter.length > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-sm font-medium">
            {connectorFilter.length}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div ref={popupRef} style={{ transform: clampStyle.transform }} className="absolute top-full left-0 mt-1 z-20 bg-background border border-primary/20 rounded-modal shadow-elevation-3 min-w-[280px] overflow-hidden">
          <div className="px-3 py-2 border-b border-primary/10">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={dropdownSearch}
                onChange={(e) => setDropdownSearch(e.target.value)}
                placeholder={t.templates.search.search_connectors}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-secondary/40 border border-primary/10 rounded-modal text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
              />
            </div>
          </div>

          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.map((item) => {
              const meta = getConnectorMeta(item.name);
              const isSelected = connectorFilter.includes(item.name);
              return (
                <button
                  key={item.name}
                  onClick={() => toggleConnector(item.name)}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-left hover:bg-primary/5 transition-colors"
                >
                  <div
                    className="w-6 h-6 rounded-card flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${meta.color}20` }}
                  >
                    <ConnectorIcon meta={meta} size="w-4 h-4" />
                  </div>
                  <span className="text-sm text-foreground/90 flex-1">{highlightMatch(meta.label, debouncedSearch.trim())}</span>
                  <span className="text-sm text-foreground tabular-nums px-1.5 py-0.5 rounded-full bg-secondary/60">
                    {item.count}
                  </span>
                  <div
                    className={`w-4.5 h-4.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-violet-500/30 border-violet-500/50'
                        : 'border-primary/20'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-violet-300" />}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3.5 py-3 text-sm text-foreground italic text-center">
                {dropdownSearch ? t.templates.search.no_matching_connectors : t.templates.search.no_connectors_available}
              </div>
            )}
          </div>

          {connectorFilter.length > 0 && (
            <div className="border-t border-primary/10 px-1 py-1">
              <button
                onClick={() => {
                  setConnectorFilter([]);
                  setIsOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left text-sm text-foreground hover:text-foreground/95 hover:bg-primary/5 rounded-modal transition-colors"
              >
                {t.templates.search.clear_all}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
