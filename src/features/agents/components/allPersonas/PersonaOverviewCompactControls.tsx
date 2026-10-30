import { useTranslation } from '@/i18n/useTranslation';
import { PersonaOverviewFilterHeader } from './PersonaOverviewFilterHeader';
import { usePersonaFilterOptions } from './usePersonaFilterOptions';
import { DEFAULT_VIEW_CONFIG, type AgentListViewConfig } from './viewConfig';

interface PersonaOverviewCompactControlsProps {
  view: AgentListViewConfig;
  onViewChange: (next: AgentListViewConfig) => void;
  allConnectorNames: string[];
}

const DEFAULT_SORT = `${DEFAULT_VIEW_CONFIG.sortKey}:${DEFAULT_VIEW_CONFIG.sortDirection}`;

/**
 * Sort and the three column filters for the compact (card list) roster. In
 * the grid they live in the column headers; the card list has no headers, so
 * without this row a narrow window lost sorting and filtering altogether.
 * Same option vocabularies as the headers (usePersonaFilterOptions).
 */
export function PersonaOverviewCompactControls({ view, onViewChange, allConnectorNames }: PersonaOverviewCompactControlsProps) {
  const { t } = useTranslation();
  const options = usePersonaFilterOptions(allConnectorNames);
  const sortValue = view.sortKey ? `${view.sortKey}:${view.sortDirection}` : DEFAULT_SORT;

  return (
    <div className="px-3 py-1.5 border-b border-primary/5 flex items-center gap-4 flex-wrap" data-testid="roster-compact-controls">
      <PersonaOverviewFilterHeader
        label={t.agents.persona_list.sort_label}
        value={sortValue}
        unfilteredValue={DEFAULT_SORT}
        options={options.sort}
        onChange={(v) => {
          const [sortKey, dir] = v.split(':');
          onViewChange({ ...view, sortKey: sortKey ?? null, sortDirection: dir === 'asc' ? 'asc' : 'desc' });
        }}
      />
      <PersonaOverviewFilterHeader
        label={t.agents.overview_columns.status}
        value={view.statusFilter}
        options={options.status}
        onChange={(v) => onViewChange({ ...view, statusFilter: v })}
      />
      <PersonaOverviewFilterHeader
        label={t.agents.overview_columns.health}
        value={view.healthFilter}
        options={options.health}
        onChange={(v) => onViewChange({ ...view, healthFilter: v })}
      />
      <PersonaOverviewFilterHeader
        label={t.common.connectors}
        value={view.connectorFilter}
        options={options.connector}
        onChange={(v) => onViewChange({ ...view, connectorFilter: v })}
        alignRight
      />
    </div>
  );
}
