import { useMemo } from 'react';
import { ArrowLeftRight, FlaskConical, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import {
  ExecutionCostCell, ExecutionDurationCell, ExecutionStartedCell, ExecutionStatusPill, ExecutionTokensCell, byStartTime,
} from '../table/ExecutionCells';
import { formatTokens } from '../../libs/useExecutionList';
import { deriveExecutionOrigin, type ExecutionOrigin } from '../../libs/executionOrigin';
import { OriginBadge, originLabel } from './OriginBadge';
import { OriginFilterDropdown } from './OriginFilterDropdown';
import { ExecutionValueBadges } from './ExecutionValueBadges';

export const STATUS_FILTERS = ['all', 'running', 'completed', 'failed', 'cancelled'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

const CHIP = 'inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-card border';

interface ExecutionColumnsArgs {
  capabilityTitle: (id: string | null) => string | null;
  capabilityOptions: { value: string; label: string }[];
  capabilityFilter: string;
  onCapabilityFilter: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (v: StatusFilter) => void;
  originFilter: ExecutionOrigin | null;
  onOriginFilter: (v: ExecutionOrigin | null) => void;
  /** Leading selection cell — a bulk checkbox or the compare A/B slot. */
  selectCell: ((row: ExecutionListItem) => React.ReactNode) | null;
  onCompareRetry: ((id: string) => void) | null;
}

/** Column set for the persona run ledger. */
export function useExecutionColumns(a: ExecutionColumnsArgs): TableColumn<ExecutionListItem>[] {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;

  return useMemo<TableColumn<ExecutionListItem>[]>(() => {
    const cols: TableColumn<ExecutionListItem>[] = [];
    if (a.selectCell) {
      cols.push({ key: 'select', label: e.bulk_rerun_col_header, width: '48px', render: a.selectCell });
    }
    cols.push(
      {
        key: 'status',
        label: e.col_status,
        width: '180px',
        filterOptions: STATUS_FILTERS.map((s) => ({
          value: s,
          label: s === 'all' ? t.overview.activity.all_statuses : tokenLabel(t, 'execution', s),
        })),
        filterValue: a.statusFilter,
        onFilterChange: (v) => a.onStatusFilter(v as StatusFilter),
        render: (row) => (
          <div className="flex items-center gap-1.5 min-w-0">
            <ExecutionStatusPill status={row.status} />
            {row.retry_count > 0 && (
              <Tooltip content={tx(e.healing_retry, { count: row.retry_count })}>
                <span className={`${CHIP} bg-status-info/10 text-status-info border-status-info/20`}>
                  <RefreshCw className="w-2.5 h-2.5" />#{row.retry_count}
                </span>
              </Tooltip>
            )}
            {row.is_simulation && (
              <Tooltip content={e.simulated_badge_tooltip}>
                <span className={`${CHIP} bg-status-neutral/10 text-status-neutral border-status-neutral/20`}>
                  <FlaskConical className="w-2.5 h-2.5" />
                </span>
              </Tooltip>
            )}
          </div>
        ),
      },
      {
        key: 'capability',
        label: e.col_capability,
        width: 'minmax(180px,2fr)',
        filterOptions: a.capabilityOptions,
        filterValue: a.capabilityFilter,
        onFilterChange: a.onCapabilityFilter,
        render: (row) => {
          const title = a.capabilityTitle(row.use_case_id);
          if (!title) return <span className="block typo-body truncate text-foreground italic">{e.capability_unattributed}</span>;
          return (
            <Tooltip content={title}>
              <span className="block typo-body truncate text-foreground">{title}</span>
            </Tooltip>
          );
        },
      },
      {
        key: 'origin',
        label: e.origin_filter_label,
        width: '150px',
        filterComponent: <OriginFilterDropdown value={a.originFilter} onChange={a.onOriginFilter} />,
        render: (row) => {
          const o = deriveExecutionOrigin(row);
          // The badge stays silent for the unmarked origins; a ledger cell still names them.
          if (o.origin === 'manual' || o.origin === 'simulation') {
            return <span className="typo-body text-foreground">{originLabel(t, o.origin)}</span>;
          }
          return <OriginBadge origin={o.origin} lane={o.lane} />;
        },
      },
      {
        key: 'verdict',
        label: e.verdict_field,
        width: '140px',
        render: (row) => (
          <div className="flex items-center gap-1.5 min-w-0">
            <ExecutionValueBadges businessOutcome={row.business_outcome} />
          </div>
        ),
      },
      {
        key: 'tokens',
        label: e.col_tokens,
        width: '110px',
        align: 'right',
        sortable: true,
        sortFn: (x, y) => (x.input_tokens + x.output_tokens) - (y.input_tokens + y.output_tokens),
        render: (row) => <ExecutionTokensCell input={row.input_tokens} output={row.output_tokens} format={formatTokens} />,
      },
      {
        key: 'cost',
        label: e.col_cost,
        width: '90px',
        align: 'right',
        sortable: true,
        sortFn: (x, y) => (x.cost_usd ?? -1) - (y.cost_usd ?? -1),
        render: (row) => <ExecutionCostCell cost={row.cost_usd} />,
      },
      {
        key: 'duration',
        label: e.col_duration,
        width: '90px',
        align: 'right',
        sortable: true,
        sortFn: (x, y) => (x.duration_ms ?? -1) - (y.duration_ms ?? -1),
        render: (row) => <ExecutionDurationCell ms={row.duration_ms} />,
      },
      {
        key: 'started',
        label: e.col_started,
        width: '120px',
        align: 'right',
        sortable: true,
        sortFn: byStartTime((r) => r.started_at || r.created_at),
        render: (row) => <ExecutionStartedCell startedAt={row.started_at} createdAt={row.created_at} />,
      },
    );
    if (a.onCompareRetry) {
      const onCompareRetry = a.onCompareRetry;
      cols.push({
        key: 'actions',
        label: '',
        width: '44px',
        align: 'right',
        render: (row) => row.retry_count > 0 ? (
          <Tooltip content={e.compare_with_original}>
            <button
              type="button"
              aria-label={e.compare_with_original}
              onClick={(ev) => { ev.stopPropagation(); onCompareRetry(row.id); }}
              className="p-1 rounded-interactive text-foreground hover:text-accent hover:bg-accent/10 transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        ) : null,
      });
    }
    return cols;
  }, [a, e, t, tx]);
}
