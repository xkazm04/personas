import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Search, Layers, ChevronDown, CheckCircle2 } from 'lucide-react';
import { ARCH_CATEGORIES, type ArchCategory } from '../../matrix/architecturalCategories';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useViewportClampAbsolute } from '@/hooks/utility/interaction/useViewportClamp';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { highlightMatch } from '@/lib/ui/highlightMatch';

interface ComponentWithCount {
  key: string;
  count: number;
}

export function ComponentFilterDropdown({
  availableComponents,
  componentFilter,
  setComponentFilter,
}: {
  availableComponents: ComponentWithCount[];
  componentFilter: string[];
  setComponentFilter: (components: string[]) => void;
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

  const toggleComponent = (key: string) => {
    if (componentFilter.includes(key)) {
      setComponentFilter(componentFilter.filter((c) => c !== key));
    } else {
      setComponentFilter([...componentFilter, key]);
    }
  };

  const sorted = useMemo(() =>
    [...availableComponents].sort((a, b) => {
      const la = ARCH_CATEGORIES[a.key]?.label ?? a.key;
      const lb = ARCH_CATEGORIES[b.key]?.label ?? b.key;
      return la.localeCompare(lb);
    }),
    [availableComponents],
  );

  const debouncedSearch = useDebounce(dropdownSearch, 150);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) => {
      const cat = ARCH_CATEGORIES[item.key];
      const label = cat?.label ?? item.key;
      return label.toLowerCase().includes(q) || item.key.toLowerCase().includes(q);
    });
  }, [sorted, debouncedSearch]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 text-sm rounded-modal border border-primary/15 hover:bg-secondary/50 text-muted-foreground/80 transition-colors flex items-center gap-1.5"
      >
        <Layers className="w-3.5 h-3.5" />
        {t.templates.search.components_label}
        {componentFilter.length > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-sm font-medium">
            {componentFilter.length}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div ref={popupRef} style={{ transform: clampStyle.transform }} className="absolute top-full left-0 mt-1 z-20 bg-background border border-primary/20 rounded-modal shadow-elevation-3 min-w-[280px] overflow-hidden">
          <div className="px-3 py-2 border-b border-primary/10">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <input
                ref={searchInputRef}
                type="text"
                value={dropdownSearch}
                onChange={(e) => setDropdownSearch(e.target.value)}
                placeholder={t.templates.search.search_components}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-secondary/40 border border-primary/10 rounded-modal text-foreground/90 placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
              />
            </div>
          </div>

          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.map((item) => {
              const cat: ArchCategory | undefined = ARCH_CATEGORIES[item.key];
              if (!cat) return null;
              const CatIcon = cat.icon;
              const isSelected = componentFilter.includes(item.key);
              return (
                <button
                  key={item.key}
                  onClick={() => toggleComponent(item.key)}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-left hover:bg-primary/5 transition-colors"
                >
                  <div
                    className="w-6 h-6 rounded-card flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${cat.color}20` }}
                  >
                    <CatIcon className="w-4 h-4" style={{ color: cat.color }} />
                  </div>
                  <span className="text-sm text-foreground/90 flex-1">{highlightMatch(cat.label, debouncedSearch.trim())}</span>
                  <span className="text-sm text-muted-foreground/50 tabular-nums px-1.5 py-0.5 rounded-full bg-secondary/60">
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
              <div className="px-3.5 py-3 text-sm text-muted-foreground/60 italic text-center">
                {dropdownSearch ? t.templates.search.no_matching_components : t.templates.search.no_components_available}
              </div>
            )}
          </div>

          {componentFilter.length > 0 && (
            <div className="border-t border-primary/10 px-1 py-1">
              <button
                onClick={() => {
                  setComponentFilter([]);
                  setIsOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left text-sm text-muted-foreground/90 hover:text-foreground/95 hover:bg-primary/5 rounded-modal transition-colors"
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
