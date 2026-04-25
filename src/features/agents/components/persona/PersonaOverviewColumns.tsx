import { useMemo } from 'react';
import { Calendar, Clock, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { BuildingBadge, HEALTH_STYLES, StatusBadge, TrustScoreBar } from './PersonaOverviewBadges';
import { PersonaOverviewFilterHeader, type FilterOption } from './PersonaOverviewFilterHeader';
import { ConnectorsCell, FavoriteCell, NameCell, SelectCell } from './PersonaOverviewCells';
import type { AgentListViewConfig } from './ViewPresetBar';

interface UsePersonaColumnsArgs {
  view: AgentListViewConfig;
  setView: (next: AgentListViewConfig) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  onRowClick: (p: Persona) => void;
  isBuilding: (id: string) => boolean;
  isDraft: (p: Persona) => boolean;
  healthMap: Record<string, PersonaHealth | undefined>;
  triggerCounts: Record<string, number>;
  lastRunMap: Record<string, string | null>;
  connectorNamesMap: Map<string, string[]>;
  allConnectorNames: string[];
}

// Moved inside the hook to access translation keys

export function usePersonaColumns(args: UsePersonaColumnsArgs): DataGridColumn<Persona>[] {
  const { t } = useTranslation();
  const {
    view, setView, selectedIds, onToggleSelect, isFavorite, toggleFavorite, onRowClick,
    isBuilding, isDraft, healthMap, triggerCounts, lastRunMap,
    connectorNamesMap, allConnectorNames,
  } = args;

  const STATUS_FILTER_OPTIONS: FilterOption[] = [
    { value: 'all', label: t.agents.overview_columns.all_statuses },
    { value: 'enabled', label: t.agents.overview_columns.active_only },
    { value: 'disabled', label: t.agents.overview_columns.disabled_only },
    { value: 'building', label: t.agents.overview_columns.building_drafts },
  ];

  const HEALTH_FILTER_OPTIONS: FilterOption[] = [
    { value: 'all', label: t.agents.overview_columns.all_health },
    { value: 'healthy', label: HEALTH_STYLES.healthy!.label },
    { value: 'degraded', label: HEALTH_STYLES.degraded!.label },
    { value: 'failing', label: HEALTH_STYLES.failing!.label },
  ];

  const connectorOptions = useMemo<FilterOption[]>(
    () => [
      { value: 'all', label: 'All Connectors' },
      ...allConnectorNames.map((n) => ({ value: n, label: n })),
    ],
    [allConnectorNames],
  );

  return useMemo<DataGridColumn<Persona>[]>(
    () => [
      {
        key: 'select', label: '', width: '40px',
        render: (p) => (
          <SelectCell persona={p} selected={selectedIds.has(p.id)} onToggle={onToggleSelect} />
        ),
      },
      {
        key: 'favorite', label: '', width: '36px',
        render: (p) => (
          <FavoriteCell persona={p} isFavorite={isFavorite(p.id)} onToggle={toggleFavorite} />
        ),
      },
      {
        key: 'name', label: t.agents.persona_list.col_persona, width: 'minmax(240px, 1.6fr)', sortable: true,
        render: (p) => <NameCell persona={p} onClick={onRowClick} />,
      },
      {
        key: 'connectors', label: t.common.connectors, width: 'minmax(120px, 0.8fr)',
        filterComponent: (
          <PersonaOverviewFilterHeader
            label="Connectors"
            value={view.connectorFilter}
            options={connectorOptions}
            onChange={(v) => setView({ ...view, connectorFilter: v })}
          />
        ),
        render: (p) => <ConnectorsCell persona={p} connectorNamesMap={connectorNamesMap} />,
      },
      {
        key: 'status', label: t.agents.overview_columns.status, width: 'minmax(120px, 0.9fr)',
        filterComponent: (
          <PersonaOverviewFilterHeader
            label="Status"
            value={view.statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(v) => setView({ ...view, statusFilter: v })}
          />
        ),
        render: (p) =>
          isBuilding(p.id)
            ? <BuildingBadge />
            : <StatusBadge enabled={p.enabled} health={healthMap[p.id]} isDraft={isDraft(p)} />,
      },
      {
        key: 'trust', label: t.agents.overview_columns.trust, width: 'minmax(140px, 1fr)', sortable: true,
        filterComponent: (
          <PersonaOverviewFilterHeader
            label="Trust"
            value={view.healthFilter}
            options={HEALTH_FILTER_OPTIONS}
            onChange={(v) => setView({ ...view, healthFilter: v })}
          />
        ),
        render: (p) =>
          (!p.enabled || isDraft(p))
            ? <span className="text-md text-foreground">--</span>
            : <TrustScoreBar score={p.trust_score ?? 0} />,
      },
      {
        key: 'triggers', label: t.common.triggers, width: '90px', sortable: true, align: 'right',
        render: (p) => (
          <Tooltip content={`${triggerCounts[p.id] ?? 0} active trigger(s)`}>
            <span className="flex items-center justify-end gap-1 text-md text-foreground">
              <Zap className="w-3.5 h-3.5" />
              {triggerCounts[p.id] ?? 0}
            </span>
          </Tooltip>
        ),
      },
      {
        key: 'lastRun', label: t.agents.overview_columns.last_run, width: '120px', sortable: true, align: 'right',
        render: (p) => {
          const lastRun = lastRunMap[p.id];
          if (!lastRun) return <span className="text-md text-foreground">{t.agents.persona_list.never}</span>;
          return (
            <Tooltip content={new Date(lastRun).toLocaleString()}>
              <span className="flex items-center justify-end gap-1 text-md text-foreground cursor-help">
                <Clock className="w-3.5 h-3.5" />
                {formatRelativeTime(lastRun)}
              </span>
            </Tooltip>
          );
        },
      },
      {
        key: 'created', label: 'Created', width: '120px', sortable: true, align: 'right',
        render: (p) =>
          p.created_at ? (
            <Tooltip content={new Date(p.created_at).toLocaleString()}>
              <span className="flex items-center justify-end gap-1 text-md text-foreground cursor-help">
                <Calendar className="w-3.5 h-3.5" />
                {formatRelativeTime(p.created_at)}
              </span>
            </Tooltip>
          ) : (
            <span className="text-md text-foreground">--</span>
          ),
      },
    ],
    [
      view, setView, selectedIds, onToggleSelect, isFavorite, toggleFavorite, onRowClick,
      isBuilding, isDraft, healthMap, triggerCounts, lastRunMap,
      connectorNamesMap, connectorOptions,
    ],
  );
}
