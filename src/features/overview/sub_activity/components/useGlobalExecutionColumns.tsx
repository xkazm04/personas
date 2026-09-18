import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { PersonaColumnFilter } from '@/features/agents/components/PersonaColumnFilter';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { formatModelShort } from '@/lib/utils/formatters';
import type { GlobalExecutionListItem } from '@/lib/bindings/GlobalExecutionListItem';
import type { Persona } from '@/lib/bindings/Persona';
import {
  ExecutionCostCell, ExecutionDurationCell, ExecutionStartedCell, ExecutionStatusPill, byStartTime,
} from '@/features/agents/sub_executions/components/table/ExecutionCells';
import { FILTER_ORDER, type FilterStatus } from './useGlobalExecutionFeed';

interface GlobalColumnsArgs {
  personas: Persona[];
  personaModelById: Map<string, string>;
  models: string[];
  selectedPersonaId: string;
  onPersonaChange: (id: string) => void;
  filter: FilterStatus;
  onFilterChange: (f: FilterStatus) => void;
  modelFilter: string;
  onModelFilterChange: (m: string) => void;
}

/** Column set for the Overview activity ledger (all personas). */
export function useGlobalExecutionColumns(a: GlobalColumnsArgs): TableColumn<GlobalExecutionListItem>[] {
  const { t } = useTranslation();
  const act = t.overview.activity;
  const {
    personas, personaModelById, models, selectedPersonaId, onPersonaChange,
    filter, onFilterChange, modelFilter, onModelFilterChange,
  } = a;

  return useMemo<TableColumn<GlobalExecutionListItem>[]>(() => [
    {
      key: 'persona',
      label: '',
      width: 'minmax(240px,2fr)',
      filterComponent: <PersonaColumnFilter value={selectedPersonaId} onChange={onPersonaChange} personas={personas} />,
      render: (exec) => (
        <div className="flex items-center gap-2 min-w-0">
          <PersonaIcon icon={exec.personaIcon ?? null} color={exec.personaColor ?? null} name={exec.personaName ?? undefined} display="framed" frameSize="lg" />
          <span className="typo-body text-foreground truncate">{exec.personaName || act.unknown}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: act.col_status,
      width: 'minmax(0,1fr)',
      filterOptions: FILTER_ORDER.map((id) => ({
        value: id,
        label: id === 'all' ? act.all_statuses : tokenLabel(t, 'execution', id),
      })),
      filterValue: filter,
      onFilterChange: (v) => onFilterChange(v as FilterStatus),
      render: (exec) => <ExecutionStatusPill status={exec.status} />,
    },
    {
      key: 'model',
      label: act.col_model,
      width: '130px',
      filterOptions: [
        { value: 'all', label: act.all_models },
        ...models.map((m) => ({ value: m, label: formatModelShort(m) ?? m })),
      ],
      filterValue: modelFilter,
      onFilterChange: onModelFilterChange,
      render: (exec) => {
        const full = exec.modelUsed ?? personaModelById.get(exec.personaId) ?? null;
        const short = formatModelShort(full);
        if (!short) return <span className="typo-body text-foreground font-mono">—</span>;
        return (
          <Tooltip content={full ?? ''}>
            <span className="block typo-body text-foreground font-mono truncate">{short}</span>
          </Tooltip>
        );
      },
    },
    {
      key: 'cost',
      label: act.col_cost,
      width: '96px',
      align: 'right',
      sortable: true,
      sortFn: (x, y) => (x.costUsd ?? -1) - (y.costUsd ?? -1),
      render: (exec) => <ExecutionCostCell cost={exec.costUsd} />,
    },
    {
      key: 'duration',
      label: act.col_duration,
      width: '110px',
      align: 'right',
      sortable: true,
      sortFn: (x, y) => (x.durationMs ?? -1) - (y.durationMs ?? -1),
      render: (exec) => <ExecutionDurationCell ms={exec.durationMs} />,
    },
    {
      key: 'started',
      label: act.col_started,
      width: '150px',
      align: 'right',
      sortable: true,
      sortFn: byStartTime((e) => e.startedAt || e.createdAt),
      render: (exec) => <ExecutionStartedCell startedAt={exec.startedAt} createdAt={exec.createdAt} />,
    },
  ], [t, act, personas, personaModelById, models, selectedPersonaId, onPersonaChange, filter, onFilterChange, modelFilter, onModelFilterChange]);
}
