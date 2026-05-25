import { memo, useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import type { ToolPerformanceSummary } from '@/lib/bindings/ToolPerformanceSummary';
import { getToolPerformanceSummary } from '@/api/agents/tools';
import { useTranslation } from '@/i18n/useTranslation';
import { CARD_CONTAINER } from '@/features/overview/libs/dashboardGrid';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { CARD_PADDING } from '@/lib/utils/designTokens';
import { silentCatch } from '@/lib/silentCatch';

interface ToolPerformancePanelProps {
  /** ISO 8601 string. Rows older than this are excluded. */
  since: string;
  /** Optional persona scope. Omit to aggregate across all personas. */
  personaId?: string;
  /** Cap on rows returned by the backend. Default 8 (panel-sized). */
  limit?: number;
}

const DEFAULT_LIMIT = 8;

function formatMs(ms: number | null | undefined, suffix: string): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ${suffix}`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function errorRatePercent(row: ToolPerformanceSummary): number {
  const total = Number(row.total_runs);
  if (!total) return 0;
  return (Number(row.error_runs) / total) * 100;
}

/**
 * Tool performance overview for the Activity dashboard. Surfaces mean / max
 * latency and error rate per tool over the configured time window, sourced
 * from `tool_execution_audit_log`.
 *
 * Distinct from `ToolUsageSummary` (which counts invocations from
 * `persona_tool_usage`). This panel is the latency + reliability lens — the
 * existing usage panels stay focused on invocation counts.
 */
export const ToolPerformancePanel = memo(function ToolPerformancePanel({
  since,
  personaId,
  limit = DEFAULT_LIMIT,
}: ToolPerformancePanelProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ToolPerformanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getToolPerformanceSummary(since, personaId, limit)
      .then((result) => {
        if (cancelled) return;
        setRows(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        silentCatch('getToolPerformanceSummary')(err);
        setRows([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [since, personaId, limit]);

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => Number(b.total_runs) - Number(a.total_runs)),
    [rows],
  );

  // Distinct tool types drive the per-column filter. Type identifiers (mcp,
  // builtin, connector, …) are technical and untranslated; only the "All"
  // option is localized, reusing the shared common.all key (no new strings).
  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.tool_type);
    return [
      { value: 'all', label: t.common.all },
      ...[...set].sort((a, b) => a.localeCompare(b)).map((tt) => ({ value: tt, label: tt })),
    ];
  }, [rows, t.common.all]);

  const visibleRows = useMemo(
    () => (typeFilter === 'all' ? sortedRows : sortedRows.filter((r) => r.tool_type === typeFilter)),
    [sortedRows, typeFilter],
  );

  const columns = useMemo<TableColumn<ToolPerformanceSummary>[]>(() => {
    const ms = t.overview.widgets.tool_performance_unit_ms;
    return [
      {
        key: 'tool',
        label: t.overview.widgets.tool_performance_col_tool,
        width: 'minmax(120px, 1.6fr)',
        sortable: true,
        sortFn: (a, b) => a.tool_name.localeCompare(b.tool_name),
        filterOptions: typeOptions,
        filterValue: typeFilter,
        onFilterChange: setTypeFilter,
        render: (row) => (
          <span className="inline-flex items-baseline gap-2 min-w-0">
            <span className="text-foreground truncate">{row.tool_name}</span>
            <span className="typo-caption text-foreground shrink-0">{row.tool_type}</span>
          </span>
        ),
      },
      {
        key: 'runs',
        label: t.overview.widgets.tool_performance_col_runs,
        width: 'minmax(64px, 0.7fr)',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => Number(a.total_runs) - Number(b.total_runs),
        render: (row) => (
          <span className="tabular-nums text-foreground">{Number(row.total_runs).toLocaleString()}</span>
        ),
      },
      {
        key: 'avg',
        label: t.overview.widgets.tool_performance_col_avg,
        width: 'minmax(64px, 0.7fr)',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => (Number(a.avg_duration_ms) || 0) - (Number(b.avg_duration_ms) || 0),
        render: (row) => (
          <span className="tabular-nums text-foreground">{formatMs(row.avg_duration_ms ?? null, ms)}</span>
        ),
      },
      {
        key: 'max',
        label: t.overview.widgets.tool_performance_col_max,
        width: 'minmax(64px, 0.7fr)',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => (Number(a.max_duration_ms) || 0) - (Number(b.max_duration_ms) || 0),
        render: (row) => (
          <span className="tabular-nums text-foreground">
            {formatMs(
              row.max_duration_ms === null || row.max_duration_ms === undefined
                ? null
                : Number(row.max_duration_ms),
              ms,
            )}
          </span>
        ),
      },
      {
        key: 'errors',
        label: t.overview.widgets.tool_performance_col_errors,
        width: 'minmax(80px, 1fr)',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => errorRatePercent(a) - errorRatePercent(b),
        render: (row) => {
          const errPct = errorRatePercent(row);
          const errClass =
            errPct >= 10 ? 'text-rose-400' : errPct >= 1 ? 'text-amber-400' : 'text-foreground';
          return (
            <span className={`tabular-nums ${errClass}`}>
              {Number(row.error_runs) === 0
                ? '0'
                : `${Number(row.error_runs).toLocaleString()} (${errPct.toFixed(1)}%)`}
            </span>
          );
        },
      },
    ];
  }, [t, typeOptions, typeFilter]);

  return (
    <div
      className={`${CARD_CONTAINER} ${CARD_PADDING.standard} space-y-3 relative overflow-hidden`}
      aria-label={t.overview.widgets.tool_performance}
    >
      <div className="flex items-center justify-between relative z-10">
        <h3 className="typo-label text-foreground flex items-center gap-2">
          <div className="p-1.5 rounded-card bg-violet-500/10 text-violet-400">
            <Activity className="w-3.5 h-3.5" />
          </div>
          {t.overview.widgets.tool_performance}
        </h3>
        <span className="typo-caption text-foreground">
          {t.overview.widgets.tool_performance_subtitle}
        </span>
      </div>

      <div className="relative z-10">
        {loading ? (
          <div className="h-32" />
        ) : sortedRows.length === 0 ? (
          <EmptyState variant="chart" className="py-6" />
        ) : (
          <UnifiedTable<ToolPerformanceSummary>
            columns={columns}
            data={visibleRows}
            getRowKey={(row) => `${row.tool_name}-${row.tool_type}`}
            density="compact"
            defaultSortKey="runs"
            emptyTitle={t.overview.events.no_filter_match}
            rowAccent={(row) => {
              const errPct = errorRatePercent(row);
              return errPct >= 10 ? 'border-l-rose-400/70' : errPct >= 1 ? 'border-l-amber-400/70' : undefined;
            }}
            className="typo-caption"
          />
        )}
      </div>
    </div>
  );
});
