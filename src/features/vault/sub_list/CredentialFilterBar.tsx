import { Tag, ChevronDown, X } from 'lucide-react';
import { getTagStyle } from '@/features/vault/utils/credentialTags';
import { type HealthFilter, type SortKey, healthFilterLabel, sortLabel } from './credentialListTypes';

interface CredentialFilterBarProps {
  allTags: string[];
  selectedTags: string[];
  toggleTag: (tag: string) => void;
  healthFilter: HealthFilter;
  setHealthFilter: (f: HealthFilter) => void;
  sortKey: SortKey;
  setSortKey: (s: SortKey) => void;
  openDropdown: 'health' | 'sort' | null;
  setOpenDropdown: (v: 'health' | 'sort' | null) => void;
  hasFilters: boolean;
  clearFilters: () => void;
}

export function CredentialFilterBar({
  allTags, selectedTags, toggleTag,
  healthFilter, setHealthFilter,
  sortKey, setSortKey,
  openDropdown, setOpenDropdown,
  hasFilters, clearFilters,
}: CredentialFilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap pb-1">
      {/* Tag chips */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1">
          <Tag className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          {allTags.map((tag) => {
            const active = selectedTags.includes(tag);
            const style = getTagStyle(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`text-sm font-medium px-1.5 py-0.5 rounded border transition-colors ${
                  active
                    ? `${style.bg} ${style.text} ${style.border}`
                    : 'bg-secondary/30 text-muted-foreground/50 border-primary/10 hover:bg-secondary/50'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Health filter dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpenDropdown(openDropdown === 'health' ? null : 'health')}
          aria-haspopup="listbox"
          aria-expanded={openDropdown === 'health'}
          className={`flex items-center gap-1 text-sm font-medium px-2 py-1 rounded border transition-colors ${
            healthFilter !== 'all'
              ? 'bg-primary/10 text-primary border-primary/20'
              : 'bg-secondary/30 text-muted-foreground/50 border-primary/10 hover:bg-secondary/50'
          }`}
        >
          {healthFilterLabel(healthFilter)}
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
        {openDropdown === 'health' && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpenDropdown(null)} />
            <div role="listbox" className="absolute top-full mt-1 left-0 z-20 bg-background border border-primary/15 rounded-lg shadow-elevation-3 py-1 min-w-[100px]">
              {(['all', 'healthy', 'failing', 'untested'] as HealthFilter[]).map((f) => (
                <button
                  key={f}
                  role="option"
                  aria-selected={f === healthFilter}
                  onClick={() => { setHealthFilter(f); setOpenDropdown(null); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/50 transition-colors ${
                    f === healthFilter ? 'text-primary font-medium' : 'text-foreground/80'
                  }`}
                >
                  {healthFilterLabel(f)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Sort dropdown */}
      <div className="relative ml-auto">
        <button
          onClick={() => setOpenDropdown(openDropdown === 'sort' ? null : 'sort')}
          aria-haspopup="listbox"
          aria-expanded={openDropdown === 'sort'}
          className="flex items-center gap-1 text-sm font-medium px-2 py-1 rounded border bg-secondary/30 text-muted-foreground/50 border-primary/10 hover:bg-secondary/50 transition-colors"
        >
          Sort: {sortLabel(sortKey)}
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
        {openDropdown === 'sort' && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpenDropdown(null)} />
            <div role="listbox" className="absolute top-full mt-1 right-0 z-20 bg-background border border-primary/15 rounded-lg shadow-elevation-3 py-1 min-w-[110px]">
              {(['name', 'created', 'last-used', 'health'] as SortKey[]).map((s) => (
                <button
                  key={s}
                  role="option"
                  aria-selected={s === sortKey}
                  onClick={() => { setSortKey(s); setOpenDropdown(null); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/50 transition-colors ${
                    s === sortKey ? 'text-primary font-medium' : 'text-foreground/80'
                  }`}
                >
                  {sortLabel(s)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 text-sm font-medium px-1.5 py-0.5 rounded border border-red-500/15 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <X className="w-2.5 h-2.5" /> Clear
        </button>
      )}
    </div>
  );
}
