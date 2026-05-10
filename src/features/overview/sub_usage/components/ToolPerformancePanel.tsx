import { memo, useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import type { ToolPerformanceSummary } from '@/lib/bindings/ToolPerformanceSummary';
import { getToolPerformanceSummary } from '@/api/agents/tools';
import { useTranslation } from '@/i18n/useTranslation';
import { CARD_CONTAINER } from '@/features/overview/utils/dashboardGrid';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
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
          <table className="w-full typo-caption text-foreground" aria-busy={loading}>
            <thead>
              <tr className="text-foreground border-b border-primary/10">
                <th className="text-left font-normal pb-1">
                  {t.overview.widgets.tool_performance_col_tool}
                </th>
                <th className="text-right font-normal pb-1">
                  {t.overview.widgets.tool_performance_col_runs}
                </th>
                <th className="text-right font-normal pb-1">
                  {t.overview.widgets.tool_performance_col_avg}
                </th>
                <th className="text-right font-normal pb-1">
                  {t.overview.widgets.tool_performance_col_max}
                </th>
                <th className="text-right font-normal pb-1">
                  {t.overview.widgets.tool_performance_col_errors}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const errPct = errorRatePercent(row);
                const errClass =
                  errPct >= 10
                    ? 'text-rose-400'
                    : errPct >= 1
                      ? 'text-amber-400'
                      : 'text-foreground';
                return (
                  <tr
                    key={`${row.tool_name}-${row.tool_type}`}
                    className="border-b border-primary/5 last:border-b-0"
                  >
                    <td className="py-1 pr-2">
                      <span className="text-foreground">{row.tool_name}</span>
                      <span className="ml-2 typo-caption text-foreground">
                        {row.tool_type}
                      </span>
                    </td>
                    <td className="text-right py-1 tabular-nums">
                      {Number(row.total_runs).toLocaleString()}
                    </td>
                    <td className="text-right py-1 tabular-nums">
                      {formatMs(
                        row.avg_duration_ms ?? null,
                        t.overview.widgets.tool_performance_unit_ms,
                      )}
                    </td>
                    <td className="text-right py-1 tabular-nums">
                      {formatMs(
                        row.max_duration_ms === null ||
                          row.max_duration_ms === undefined
                          ? null
                          : Number(row.max_duration_ms),
                        t.overview.widgets.tool_performance_unit_ms,
                      )}
                    </td>
                    <td className={`text-right py-1 tabular-nums ${errClass}`}>
                      {Number(row.error_runs) === 0
                        ? '0'
                        : `${Number(row.error_runs).toLocaleString()} (${errPct.toFixed(1)}%)`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
