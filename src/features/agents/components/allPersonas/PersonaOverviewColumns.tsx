import { useMemo, type ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { formatCost, formatRelativeTime } from '@/lib/utils/formatters';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import type { PersonaBudgetState } from '@/stores/slices/agents/budgetEnforcementSlice';
import { BuildingBadge, StatusBadge, TrustScoreBar } from './PersonaOverviewBadges';
import { PersonaOverviewFilterHeader, type FilterOption } from './PersonaOverviewFilterHeader';
import { ConnectorsCell, FavoriteCell, NameCell, SelectCell } from './PersonaOverviewCells';
import { VerdictTrendCell } from './VerdictTrendCell';
import { PersonaRowMenu } from './PersonaRowMenu';
import type { AgentListViewConfig } from './viewConfig';

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
  /** Month-to-date spend per persona (budget-enforcement slice). Drives the
   *  money column; absent entries render as "no figure", never as $0. */
  spendMap: Map<string, PersonaBudgetState>;
  scoreTrendsMap: Record<string, number[]>;
  connectorNamesMap: Map<string, string[]>;
  allConnectorNames: string[];
  /** Row overflow: copy this agent. */
  onDuplicate: (id: string) => Promise<void> | void;
  /** Row overflow: write this agent's bundle to disk. */
  onExport: (id: string) => Promise<void> | void;
}

// Moved inside the hook to access translation keys

// Tooltip whose content is a memoized locale-formatted date. Extracted so
// the DataGrid render fns can keep returning JSX (which can't call hooks
// directly). One useMemo per row instead of per-render-pass.
function FormattedDateTooltip({ ts, children }: { ts: string | null | undefined; children: ReactNode }) {
  const formatted = useFormattedDate(ts);
  return <Tooltip content={formatted}>{children}</Tooltip>;
}

export function usePersonaColumns(args: UsePersonaColumnsArgs): DataGridColumn<Persona>[] {
  const { t, tx } = useTranslation();
  const {
    view, setView, selectedIds, onToggleSelect, isFavorite, toggleFavorite, onRowClick,
    isBuilding, isDraft, healthMap, triggerCounts, lastRunMap, spendMap, scoreTrendsMap,
    connectorNamesMap, allConnectorNames, onDuplicate, onExport,
  } = args;

  const STATUS_FILTER_OPTIONS = useMemo<FilterOption[]>(() => [
    { value: 'all', label: t.agents.overview_columns.all_statuses },
    { value: 'enabled', label: t.agents.overview_columns.active_only },
    { value: 'disabled', label: t.agents.overview_columns.disabled_only },
    { value: 'building', label: t.agents.overview_columns.building_drafts },
  ], [t.agents.overview_columns.active_only, t.agents.overview_columns.all_statuses, t.agents.overview_columns.building_drafts, t.agents.overview_columns.disabled_only]);

  const HEALTH_FILTER_OPTIONS = useMemo<FilterOption[]>(() => [
    { value: 'all', label: t.agents.overview_columns.all_health },
    { value: 'healthy', label: t.agents.status.healthy },
    { value: 'degraded', label: t.agents.status.degraded },
    { value: 'failing', label: t.agents.status.failing },
  ], [t.agents.overview_columns.all_health, t.agents.status.healthy, t.agents.status.degraded, t.agents.status.failing]);

  const connectorOptions = useMemo<FilterOption[]>(
    () => [
      { value: 'all', label: t.agents.overview_columns.all_connectors },
      ...allConnectorNames.map((n) => ({ value: n, label: n })),
    ],
    [allConnectorNames, t.agents.overview_columns.all_connectors],
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
            label={t.common.connectors}
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
            label={t.agents.overview_columns.status}
            value={view.statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(v) => setView({ ...view, statusFilter: v })}
          />
        ),
        // Lifecycle/health only. The setup-readiness warning that used to ride
        // alongside it (SetupStatusBadge) still lives on the persona editor
        // header and the mobile card list — the roster row keeps one signal.
        render: (p) =>
          isBuilding(p.id) ? (
            <BuildingBadge />
          ) : (
            <StatusBadge enabled={p.enabled} health={healthMap[p.id]} isDraft={isDraft(p)} isArchived={p.lifecycle === 'archived'} />
          ),
      },
      {
        key: 'trust', label: t.agents.overview_columns.trust, width: '110px', sortable: true,
        filterComponent: (
          <PersonaOverviewFilterHeader
            label={t.agents.overview_columns.trust}
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
        key: 'verdict', label: t.agents.overview_columns.quality, width: '88px', align: 'center',
        render: (p) => <VerdictTrendCell scores={scoreTrendsMap[p.id]} />,
      },
      {
        key: 'triggers', label: t.common.triggers, width: '90px', sortable: true, align: 'right',
        render: (p) => (
          <Tooltip content={tx(t.agents.overview_columns.active_triggers, { count: triggerCounts[p.id] ?? 0 })}>
            <span className="flex items-center justify-end gap-1 text-md text-foreground">
              <Zap className="w-3.5 h-3.5" />
              {triggerCounts[p.id] ?? 0}
            </span>
          </Tooltip>
        ),
      },
      {
        key: 'lastRun', label: t.agents.overview_columns.last_run, width: '160px', sortable: true, align: 'right',
        render: (p) => {
          const lastRun = lastRunMap[p.id];
          if (!lastRun) return <span className="text-md text-foreground">{t.agents.persona_list.never}</span>;
          return (
            <FormattedDateTooltip ts={lastRun}>
              <span className="text-md text-foreground cursor-help">
                {formatRelativeTime(lastRun)}
              </span>
            </FormattedDateTooltip>
          );
        },
      },
      {
        /**
         * The roster's money column. Until now the only cost figure in the app
         * lived inside one agent's editor, so "which of my agents is expensive"
         * was a question you answered by opening them one at a time.
         *
         * The number is MONTH-TO-DATE SPEND from the budget-enforcement slice -
         * the same figure the run gate enforces and the editor's budget chip
         * shows - not an average of the last N runs. One batched command already
         * feeds it, and a column that disagreed with the gate that blocks runs
         * would be worse than no column.
         */
        key: 'spend', label: t.agents.overview_columns.spend, width: '120px', sortable: true, align: 'right',
        render: (p) => {
          const entry = spendMap.get(p.id);
          if (!entry) {
            // No figure reported - deliberately not "$0.00": unknown and free
            // are different facts (golden path: llm-spend-accounting).
            return (
              <Tooltip content={t.agents.overview_columns.spend_hint}>
                <span className="text-md text-foreground cursor-help">-</span>
              </Tooltip>
            );
          }
          const tone =
            entry.status === 'exceeded' ? 'text-red-400'
              : entry.status === 'warning' ? 'text-amber-400'
                : 'text-foreground';
          return (
            <Tooltip content={t.agents.overview_columns.spend_hint}>
              <span className={`text-md tabular-nums cursor-help ${tone}`} data-testid={`persona-spend-${p.id}`}>
                {formatCost(entry.spend)}
              </span>
            </Tooltip>
          );
        },
      },
      {
        key: 'rowMenu', label: '', width: '44px', align: 'center',
        render: (p) => (
          <PersonaRowMenu persona={p} onDuplicate={onDuplicate} onExport={onExport} />
        ),
      },
    ],
    [onDuplicate, onExport, t.agents.persona_list.col_persona, t.agents.persona_list.never, t.agents.overview_columns.status, t.agents.overview_columns.trust, t.agents.overview_columns.last_run, t.agents.overview_columns.spend, t.agents.overview_columns.spend_hint, t.agents.overview_columns.quality, t.agents.overview_columns.active_triggers, t.common.connectors, t.common.triggers, tx, view, connectorOptions, STATUS_FILTER_OPTIONS, HEALTH_FILTER_OPTIONS, selectedIds, onToggleSelect, isFavorite, toggleFavorite, onRowClick, setView, connectorNamesMap, isBuilding, healthMap, isDraft, triggerCounts, lastRunMap, spendMap, scoreTrendsMap],
  );
}
