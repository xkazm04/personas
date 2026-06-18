/**
 * RoutingTableHeader — the sticky column-header bar above the event panels.
 *
 * Mirrors the Live Stream table header: each data column carries its own
 * filter instead of repeating a label on every row.
 *   • SOURCE    → source-persona dropdown (moved out of the toolbar)
 *   • EVENT     → free-text event filter (moved out of the toolbar)
 *   • LISTENERS → listener-persona dropdown
 *
 * Uses the same ROUTING_GRID_COLUMNS template as <EventRow /> so the header
 * cells line up with the row spine. Spacer cells match the row's icon widths.
 */
import { Search } from 'lucide-react';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { useTranslation } from '@/i18n/useTranslation';
import { ROUTING_GRID_COLUMNS } from './types';
import type { SourceOption } from './useRoutingFilters';

interface Props {
  search: string; onSearchChange: (v: string) => void;
  sourceFilter: string; onSourceFilterChange: (v: string) => void;
  sourceOptions: SourceOption[];
  listenerFilter: string; onListenerFilterChange: (v: string) => void;
  listenerOptions: SourceOption[];
}

export function RoutingTableHeader({
  search, onSearchChange,
  sourceFilter, onSourceFilterChange, sourceOptions,
  listenerFilter, onListenerFilterChange, listenerOptions,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="px-4 border-b border-primary/10 bg-secondary/5 flex-shrink-0">
      <div
        className="grid items-center gap-3 px-3 py-2.5"
        style={{ gridTemplateColumns: ROUTING_GRID_COLUMNS }}
      >
        <span className="w-3.5" aria-hidden />
        <span className="w-2.5" aria-hidden />

        {/* SOURCE */}
        <div className="min-w-0">
          <ColumnDropdownFilter
            label={t.triggers.source_personas_filter}
            value={sourceFilter}
            options={sourceOptions}
            onChange={(v) => onSourceFilterChange(v || 'all')}
            popupClassName="min-w-[320px]"
          />
        </div>

        <span className="w-3.5" aria-hidden />

        {/* EVENT */}
        <div className="relative min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t.triggers.filter_events_placeholder}
            className="w-full pl-8 pr-3 py-1 typo-body bg-secondary/30 border border-primary/10 rounded-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
        </div>

        <span className="w-3.5" aria-hidden />

        {/* LISTENERS */}
        <div className="min-w-0">
          <ColumnDropdownFilter
            label={t.triggers.listeners_filter}
            value={listenerFilter}
            options={listenerOptions}
            onChange={(v) => onListenerFilterChange(v || 'all')}
            popupClassName="min-w-[260px]"
          />
        </div>

        <span className="w-12" aria-hidden />
        <span className="w-4" aria-hidden />
      </div>
    </div>
  );
}
