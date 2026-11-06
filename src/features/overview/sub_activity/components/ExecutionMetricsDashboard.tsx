import { useCallback } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import Button from '@/features/shared/components/buttons/Button';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { TrendingUp, AlertTriangle, Zap, DollarSign, CheckCircle, Clock, Timer, RefreshCw } from 'lucide-react';
import { DayRangePicker } from '@/features/overview/sub_usage/components/DayRangePicker';
import { CompareToggle } from '@/features/overview/sub_usage/components/PersonaSelect';
import { useExecutionMetrics } from '../libs/useExecutionMetrics';
import { fmtCost, fmtMs } from '../libs/executionMetricsHelpers';
import { SUMMARY_GRID } from '@/features/overview/libs/dashboardGrid';
import { CostAnomalySection } from './CostAnomalySection';
import { KpiTile } from '@/features/overview/components/shared/KpiTile';
import { MetricsCharts } from './MetricsCharts';
import { ValueRollupSection } from './ValueRollupSection';
import { ErrorCategorySection } from './ErrorCategorySection';
import { AthenaUsageSection } from './AthenaUsageSection';
import { LlmSpendSection } from './LlmSpendSection';
import { useOverviewStore } from '@/stores/overviewStore';

interface ExecutionMetricsDashboardProps {
  /** Hand the operator back to the Activity ledger. Not a close button any
   *  more - the surface's tab switcher is the way out of this lens - it is the
   *  door the anomaly drill-down walks through after parking an execution id
   *  that only the ledger can hydrate. */
  onClose?: () => void;
}

function KpiGhosts() {
  return (
    <div className={SUMMARY_GRID} aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-[72px] rounded-card bg-primary/[0.06] animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        />
      ))}
    </div>
  );
}

export function ExecutionMetricsDashboard({ onClose }: ExecutionMetricsDashboardProps) {
  const { t, language } = useTranslation();
  const m = useExecutionMetrics();
  const hasSeries = !!m.data && m.data.daily_points.length > 0;

  // Hand the id to the Activity list's `pendingExecutionFocus` door and close
  // the wall: the list already hydrates the full record and pops
  // ExecutionDetailModal for it. The anomaly row carries no persona id, so it
  // cannot call `get_execution` itself.
  const setPendingExecutionFocus = useOverviewStore((s) => s.setPendingExecutionFocus);
  const openExecution = useCallback((id: string) => {
    setPendingExecutionFocus(id);
    onClose?.();
  }, [setPendingExecutionFocus, onClose]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* This lens's control band — always painted
          (docs/design/overview-loading.md law 5) and on the same geometry as
          Activity's FilterBar and the Calls window bar, so the row under the
          surface's shared header does not move when the lens changes.
          The title and the close button that used to sit here are gone: the
          header above names the surface and the tab switcher is the way out,
          so both repeated what position already says (doctrine 0b.3). */}
      <div className="px-4 md:px-6 py-3 border-b border-hair flex items-center gap-2 flex-shrink-0">
        <TrendingUp className="w-4 h-4 text-status-info flex-shrink-0" aria-hidden="true" />
        <DayRangePicker value={m.days} onChange={m.setDayRange} customDateRange={m.customDateRange} onCustomDateRangeChange={m.setCustomDateRange} />
        <CompareToggle enabled={m.compareEnabled} onChange={m.setCompareEnabled} />
        <span className="hidden sm:inline-flex items-center gap-1 typo-data text-ink-3">
          <Timer className="w-3 h-3" />
          {m.activeRangeLabel}
        </span>
        {m.isRefreshing && (
          <Tooltip content={t.common.refresh}><span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-caption text-status-info"
            aria-live="polite"
            aria-label={t.common.refresh}
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
          </span></Tooltip>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 xl:p-8 space-y-5">

      {m.error && !m.data ? (
        <div className="text-center py-8">
          <AlertTriangle className="w-6 h-6 text-status-error mx-auto mb-2" />
          <p className="typo-body text-status-error">{m.error}</p>
          <Button variant="link" size="sm" className="mt-2" onClick={m.load}>{t.common.retry}</Button>
        </div>
      ) : m.isInitialLoading || !m.data ? (
        <KpiGhosts />
      ) : !hasSeries ? (
        <div className="flex justify-center py-6">
          <ScenarioEmptyState art="chart" size="sm" title={t.overview.activity.no_data} />
        </div>
      ) : (
        <div className={SUMMARY_GRID}>
          <KpiTile icon={Zap} label={t.overview.activity.total_executions} color="blue" numericValue={m.summary?.totalExecutions ?? 0} compact language={language} />
          <KpiTile icon={DollarSign} label={t.overview.activity.total_cost} color="violet" numericValue={m.summary?.totalCost ?? 0} format={fmtCost} />
          <KpiTile icon={CheckCircle} label={t.overview.activity.success_rate} color="emerald" numericValue={m.overallSuccessRatePct ?? undefined} value="—" format={(v) => `${v.toFixed(1)}%`} />
          <KpiTile icon={Clock} label={t.overview.activity.avg_latency} color="amber" numericValue={m.summary?.avgLatencyMs ?? undefined} value="—" format={fmtMs} />
        </div>
      )}

      {/* Independent lanes start their IPCs on first paint — not after dashboard. */}
      {/* null until the fleet figure for THIS window is known: a $0 stand-in
          drew Athena at 100% of a fleet that had not loaded yet. */}
      <AthenaUsageSection fleetCost={m.summary ? m.summary.totalCost : null} />
      <LlmSpendSection />
      <ValueRollupSection days={m.days} />
      <ErrorCategorySection days={m.days} />

      {/* Anomalies: the badge opens the drill-down, ids open the detail modal */}
      {hasSeries && m.data && (
        <CostAnomalySection anomalies={m.summary?.anomalies ?? []} onOpenExecution={openExecution} />
      )}

      {hasSeries && m.data && (
        <MetricsCharts
          data={m.data}
          comparedChartData={m.comparedChartData}
          personaCostData={m.personaCostData}
          personaNames={m.personaNames}
          chartData={m.chartData}
          anomalyDates={m.anomalyDates}
          compareEnabled={m.compareEnabled}
        />
      )}
      </div>
    </div>
  );
}
