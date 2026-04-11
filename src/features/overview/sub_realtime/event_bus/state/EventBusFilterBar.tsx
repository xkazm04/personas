import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Search, X } from 'lucide-react';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import {
  type EventBusFilter,
  type SavedView,
  EMPTY_FILTER,
  KNOWN_EVENT_TYPES,
  KNOWN_STATUSES,
  isFilterActive,
} from './eventBusFilterTypes';
import { FilterDropdown, FilterOption } from './FilterDropdown';
import { SavedViewsDropdown } from './SavedViewsDropdown';

interface PersonaOption { id: string; name: string }

interface EventBusFilterBarProps {
  filter: EventBusFilter;
  onFilterChange: (filter: EventBusFilter) => void;
  savedViews: SavedView[];
  activeViewId: string | null;
  onApplyView: (view: SavedView) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  personas: PersonaOption[];
  discoveredSources: string[];
  filteredCount: number;
  totalCount: number;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  webhook_received: 'Webhook', execution_completed: 'Execution',
  persona_action: 'Action', credential_event: 'Credential',
  task_created: 'Task', test_event: 'Test', custom: 'Custom',
  deploy_started: 'Deploy Started', deploy_succeeded: 'Deploy OK',
  deploy_failed: 'Deploy Failed', agent_undeployed: 'Undeployed',
  credential_provisioned: 'Cred Provisioned',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', processing: '#06b6d4',
  completed: '#22c55e', processed: '#22c55e', failed: '#ef4444',
};

export default function EventBusFilterBar({
  filter, onFilterChange, savedViews, activeViewId, onApplyView, onSaveView, onDeleteView,
  personas, discoveredSources, filteredCount, totalCount,
}: EventBusFilterBarProps) {
  const { t } = useTranslation();
  const [expandedDropdown, setExpandedDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasActiveFilter = isFilterActive(filter);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setExpandedDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleArrayValue = useCallback(
    (field: keyof Pick<EventBusFilter, 'eventTypes' | 'statuses' | 'sources' | 'targetPersonaIds'>, value: string) => {
      const arr = filter[field];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      onFilterChange({ ...filter, [field]: next });
    },
    [filter, onFilterChange],
  );

  return (
    <div ref={dropdownRef} className="flex flex-wrap items-center gap-2 px-3 sm:px-4 md:px-6 py-2.5 bg-secondary/20 border-b border-primary/8">
      {/* Search input */}
      <div className="relative flex-1 min-w-[160px] max-w-[280px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
        <input
          type="text" value={filter.searchText}
          onChange={(e) => onFilterChange({ ...filter, searchText: e.target.value })}
          placeholder={t.overview.realtime_page.search_events}
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-primary/10 bg-background/40 text-foreground placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/20"
        />
      </div>

      <FilterDropdown label={t.overview.realtime_page.filter_type} activeCount={filter.eventTypes.length}
        isOpen={expandedDropdown === 'type'} onToggle={() => setExpandedDropdown(expandedDropdown === 'type' ? null : 'type')}>
        {KNOWN_EVENT_TYPES.map((type) => (
          <FilterOption key={type} label={EVENT_TYPE_LABELS[type] ?? type}
            selected={filter.eventTypes.includes(type)} color={EVENT_TYPE_HEX_COLORS[type]}
            onToggle={() => toggleArrayValue('eventTypes', type)} />
        ))}
      </FilterDropdown>

      <FilterDropdown label={t.overview.realtime_page.filter_status} activeCount={filter.statuses.length}
        isOpen={expandedDropdown === 'status'} onToggle={() => setExpandedDropdown(expandedDropdown === 'status' ? null : 'status')}>
        {KNOWN_STATUSES.map((status) => (
          <FilterOption key={status} label={status.charAt(0).toUpperCase() + status.slice(1)}
            selected={filter.statuses.includes(status)} color={STATUS_COLORS[status]}
            onToggle={() => toggleArrayValue('statuses', status)} />
        ))}
      </FilterDropdown>

      {discoveredSources.length > 0 && (
        <FilterDropdown label={t.overview.realtime_page.filter_source} activeCount={filter.sources.length}
          isOpen={expandedDropdown === 'source'} onToggle={() => setExpandedDropdown(expandedDropdown === 'source' ? null : 'source')}>
          {discoveredSources.map((src) => (
            <FilterOption key={src} label={src} selected={filter.sources.includes(src)}
              onToggle={() => toggleArrayValue('sources', src)} />
          ))}
        </FilterDropdown>
      )}

      {personas.length > 0 && (
        <FilterDropdown label={t.overview.realtime_page.filter_agent} activeCount={filter.targetPersonaIds.length}
          isOpen={expandedDropdown === 'persona'} onToggle={() => setExpandedDropdown(expandedDropdown === 'persona' ? null : 'persona')}>
          {personas.map((p) => (
            <FilterOption key={p.id} label={p.name} selected={filter.targetPersonaIds.includes(p.id)}
              onToggle={() => toggleArrayValue('targetPersonaIds', p.id)} />
          ))}
        </FilterDropdown>
      )}

      {hasActiveFilter && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground/60 font-mono">{filteredCount}/{totalCount}</span>
          <button onClick={() => onFilterChange(EMPTY_FILTER)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-red-500/15 text-red-400/80 hover:bg-red-500/10 transition-colors">
            <X className="w-3 h-3" />{t.overview.realtime_page.clear}
          </button>
        </div>
      )}

      <div className="w-px h-5 bg-primary/10 mx-1" />

      <SavedViewsDropdown
        savedViews={savedViews} activeViewId={activeViewId}
        onApplyView={onApplyView} onSaveView={onSaveView} onDeleteView={onDeleteView}
        hasActiveFilter={hasActiveFilter}
        isOpen={expandedDropdown === 'views'}
        onToggle={() => setExpandedDropdown(expandedDropdown === 'views' ? null : 'views')}
        onClose={() => setExpandedDropdown(null)}
      />
    </div>
  );
}
