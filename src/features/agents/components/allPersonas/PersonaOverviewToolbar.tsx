import { useEffect, useRef } from 'react';
import { Search, Star, X } from 'lucide-react';
import { HEALTH_STYLES } from './PersonaOverviewBadges';
import type { AgentListViewConfig } from './ViewPresetBar';
import { useTranslation } from '@/i18n/useTranslation';

const STATUS_LABELS: Record<string, string> = {
  enabled: 'Active',
  disabled: 'Disabled',
  building: 'Building / Drafts',
};

interface PersonaOverviewToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  view: AgentListViewConfig;
  onViewChange: (next: AgentListViewConfig) => void;
}

interface Chip {
  key: string;
  label: string;
  onClear: () => void;
  tone?: 'primary' | 'amber';
}

/**
 * Single-row search input + active-filter chips strip.
 *
 * Each chip shows what's currently filtering the table and can be cleared
 * individually. Pressing "/" anywhere on the page focuses the search input.
 */
export function PersonaOverviewToolbar({
  search,
  onSearchChange,
  view,
  onViewChange,
}: PersonaOverviewToolbarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" anywhere → focus search (skip when user is already typing in a field)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const chips: Chip[] = [];

  if (view.statusFilter !== 'all') {
    chips.push({
      key: 'status',
      label: STATUS_LABELS[view.statusFilter] ?? view.statusFilter,
      onClear: () => onViewChange({ ...view, statusFilter: 'all' }),
    });
  }
  if (view.healthFilter !== 'all') {
    chips.push({
      key: 'health',
      label: HEALTH_STYLES[view.healthFilter]?.label ?? view.healthFilter,
      onClear: () => onViewChange({ ...view, healthFilter: 'all' }),
    });
  }
  if (view.connectorFilter !== 'all') {
    chips.push({
      key: 'connector',
      label: view.connectorFilter,
      onClear: () => onViewChange({ ...view, connectorFilter: 'all' }),
    });
  }
  if (view.favoriteOnly) {
    chips.push({
      key: 'favorites',
      label: 'Favorites',
      tone: 'amber',
      onClear: () => onViewChange({ ...view, favoriteOnly: false }),
    });
  }
  if (search.trim()) {
    chips.push({
      key: 'search',
      label: `"${search.trim()}"`,
      onClear: () => onSearchChange(''),
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search input */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.agents.persona_list.search_personas}
          className="pl-7 pr-7 py-1.5 w-48 sm:w-56 rounded-card text-md bg-secondary/30 border border-primary/15 text-foreground placeholder:text-foreground focus:outline-none focus:bg-secondary/40 focus:border-primary/30 transition-all"
        />
        {search ? (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            title={t.agents.persona_list.clear_search}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        ) : (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1 py-0.5 rounded border border-primary/15 bg-background/60 typo-code text-[9px] text-foreground pointer-events-none">
            /
          </kbd>
        )}
      </div>

      {/* Favorites quick-toggle (icon-only) */}
      <button
        type="button"
        onClick={() => onViewChange({ ...view, favoriteOnly: !view.favoriteOnly })}
        title={view.favoriteOnly ? t.agents.persona_list.show_all_personas : t.agents.persona_list.show_only_favorites}
        aria-label={view.favoriteOnly ? t.agents.persona_list.show_all_personas : t.agents.persona_list.show_only_favorites}
        aria-pressed={view.favoriteOnly}
        className={`flex items-center justify-center p-1.5 rounded-card border transition-all ${
          view.favoriteOnly
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            : 'border-primary/15 bg-secondary/30 text-foreground hover:bg-secondary/50 hover:text-amber-400'
        }`}
      >
        <Star className={`w-3.5 h-3.5 ${view.favoriteOnly ? 'fill-amber-400' : ''}`} />
      </button>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-md border ${
                chip.tone === 'amber'
                  ? 'border-amber-500/25 bg-amber-500/10 text-amber-400'
                  : 'border-primary/20 bg-primary/10 text-primary'
              }`}
            >
              <span className="truncate max-w-[140px]">{chip.label}</span>
              <button
                type="button"
                onClick={chip.onClear}
                title={`Clear ${chip.key} filter`}
                className="p-0.5 rounded-full hover:bg-current/10 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
