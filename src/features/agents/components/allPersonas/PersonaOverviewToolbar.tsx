import { useEffect, useRef } from 'react';
import { Archive, Search, Star, X } from 'lucide-react';
import { HEALTH_STYLES } from './PersonaOverviewBadges';
import type { AgentListViewConfig } from './viewConfig';
import { useTranslation } from '@/i18n/useTranslation';
import { Kbd } from '@/features/shared/components/display/Kbd';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface PersonaOverviewToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  view: AgentListViewConfig;
  onViewChange: (next: AgentListViewConfig) => void;
  /** Home-team filter id from the drop rail; `null` when unfiltered. */
  groupFilter?: string | null;
  /** Display name for `groupFilter` (team name, or the "no team" label). */
  groupFilterLabel?: string | null;
  onClearGroupFilter?: () => void;
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
  groupFilter = null,
  groupFilterLabel = null,
  onClearGroupFilter,
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

  const statusLabels: Record<string, string> = {
    enabled: t.agents.filters.status_active,
    disabled: t.agents.filters.status_disabled,
    building: t.agents.overview_columns.building_drafts,
    archived: t.agents.persona_list.badge_archived,
  };

  const chips: Chip[] = [];

  if (view.statusFilter !== 'all') {
    chips.push({
      key: 'status',
      label: statusLabels[view.statusFilter] ?? view.statusFilter,
      onClear: () => onViewChange({ ...view, statusFilter: 'all' }),
    });
  }
  if (view.healthFilter !== 'all') {
    const healthKey = HEALTH_STYLES[view.healthFilter]?.labelKey;
    chips.push({
      key: 'health',
      label: healthKey ? t.agents.status[healthKey] : view.healthFilter,
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
      label: t.agents.filters.favorites,
      tone: 'amber',
      onClear: () => onViewChange({ ...view, favoriteOnly: false }),
    });
  }
  // The home team narrows the roster like any other filter, so it gets a chip
  // like any other filter. Without one, a team filter was invisible: the strip
  // showed nothing, and the only way back to the full roster was to find the
  // drop rail again.
  if (groupFilter !== null && groupFilterLabel && onClearGroupFilter) {
    chips.push({
      key: 'group',
      label: groupFilterLabel,
      onClear: onClearGroupFilter,
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
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-1 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          // A placeholder is not a label: it disappears on first keystroke and
          // is not an accessible name in every AT/browser pair. The sibling
          // search box in PersonaConfigPanel already carries an aria-label.
          aria-label={t.agents.persona_list.search_personas}
          placeholder={t.agents.persona_list.search_personas}
          className="pl-7 pr-7 py-1.5 w-48 sm:w-56 rounded-card typo-caption bg-surface-1 border border-hair text-ink-1 placeholder:text-ink-3 focus:outline-none focus:bg-surface-2 focus:border-primary/30 transition-all"
        />
        {search ? (
          <Button
            variant="ghost"
            size="icon-xs"
            tooltip={t.agents.persona_list.clear_search}
            aria-label={t.agents.persona_list.clear_search}
            onClick={() => onSearchChange('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2"
            icon={<X className="w-3 h-3" />}
          />
        ) : (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><Kbd>/</Kbd></span>
        )}
      </div>

      {/* Favorites quick-toggle (icon-only) */}
      <Tooltip content={view.favoriteOnly ? t.agents.persona_list.show_all_personas : t.agents.persona_list.show_only_favorites}><Button
  type="button"
  onClick={() => onViewChange({ ...view, favoriteOnly: !view.favoriteOnly })}
  aria-label={view.favoriteOnly ? t.agents.persona_list.show_all_personas : t.agents.persona_list.show_only_favorites}
  aria-pressed={view.favoriteOnly}
  variant={view.favoriteOnly ? 'secondary' : 'ghost'}
  size="icon-sm"
  icon={<Star className={`w-3.5 h-3.5 ${view.favoriteOnly ? 'fill-amber-400' : ''}`} />}
/></Tooltip>

      {/* Archived quick-toggle (icon-only) — flips between the default roster
          and the Archived view. */}
      <Tooltip content={view.statusFilter === 'archived' ? t.agents.persona_list.show_active_personas : t.agents.persona_list.show_archived_personas}><Button
  type="button"
  onClick={() =>
          onViewChange({ ...view, statusFilter: view.statusFilter === 'archived' ? 'all' : 'archived' })
        }
  aria-label={view.statusFilter === 'archived' ? t.agents.persona_list.show_active_personas : t.agents.persona_list.show_archived_personas}
  aria-pressed={view.statusFilter === 'archived'}
  variant={view.statusFilter === 'archived' ? 'secondary' : 'ghost'}
  size="icon-sm"
  icon={<Archive className="w-3.5 h-3.5" />}
/></Tooltip>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full typo-caption border ${
                chip.tone === 'amber'
                  ? 'border-status-warning/25 bg-status-warning/10 text-status-warning'
                  : 'border-hair bg-primary/10 text-primary'
              }`}
            >
              <span className="truncate max-w-[140px]">{chip.label}</span>
              <Button aria-label={t.agents.tools.clear_filter}
                type="button"
                onClick={chip.onClear}
                tooltip={t.agents.tools.clear_filter}
                variant="ghost"
                size="icon-sm"
                icon={<X className="w-2.5 h-2.5" />}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
