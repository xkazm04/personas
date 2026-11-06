import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Search, Filter, ChevronDown, CheckCircle2 } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/lib/connectors/connectorMeta';
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
    if (!isOpen) {
      setDropdownSearch('');
      return;
    }

    const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
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
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 typo-body rounded-modal border border-hair hover:bg-surface-2 text-foreground transition-colors flex items-center gap-1.5"
      >
        <Filter className="w-3.5 h-3.5" />
        {t.templates.search.connectors_label}
        {connectorFilter.length > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-role-agent/20 text-role-agent typo-body">
            {connectorFilter.length}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div ref={popupRef} style={{ transform: clampStyle.transform }} className="absolute top-full left-0 mt-1 z-20 bg-background border border-hair rounded-modal shadow-elevation-3 min-w-[280px] overflow-hidden">
          <div className="px-3 py-2 border-b border-hair">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={dropdownSearch}
                onChange={(e) => setDropdownSearch(e.target.value)}
                placeholder={t.templates.search.search_connectors}
                className="w-full pl-8 pr-3 py-1.5 typo-body bg-surface-2 border border-hair rounded-modal text-ink-1 placeholder:text-foreground focus-visible:outline-none focus-visible:border-role-agent/30 transition-colors"
              />
            </div>
          </div>

          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.map((item) => {
              const meta = getConnectorMeta(item.name);
              const isSelected = connectorFilter.includes(item.name);
              return (
                <button
                  type="button"
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
                  <span className="typo-body text-ink-1 flex-1">{highlightMatch(meta.label, debouncedSearch.trim())}</span>
                  <span className="typo-data text-foreground px-1.5 py-0.5 rounded-full bg-surface-2">
                    {item.count}
                  </span>
                  <div
                    className={`w-4.5 h-4.5 rounded-interactive border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-role-agent/30 border-role-agent/50'
                        : 'border-hair'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-role-agent" />}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3.5 py-3 typo-body text-foreground italic text-center">
                {dropdownSearch ? t.templates.search.no_matching_connectors : t.templates.search.no_connectors_available}
              </div>
            )}
          </div>

          {connectorFilter.length > 0 && (
            <div className="border-t border-hair px-1 py-1">
              <button
                type="button"
                onClick={() => {
                  setConnectorFilter([]);
                  setIsOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left typo-body text-foreground hover:text-ink-1 hover:bg-primary/5 rounded-modal transition-colors"
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
