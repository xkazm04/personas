import { useCallback } from 'react';
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
      <div className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-2 flex-shrink-0">
        <TrendingUp className="w-4 h-4 text-blue-400 flex-shrink-0" aria-hidden="true" />
        <DayRangePicker value={m.days} onChange={m.setDayRange} customDateRange={m.customDateRange} onCustomDateRangeChange={m.setCustomDateRange} />
        <CompareToggle enabled={m.compareEnabled} onChange={m.setCompareEnabled} />
        <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-card bg-blue-500/8 border border-blue-500/15 text-[11px] text-blue-400/70">
          <Timer className="w-3 h-3" />
          {m.activeRangeLabel}
        </span>
        {m.isRefreshing && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-blue-400/70"
            aria-live="polite"
            aria-label={t.common.refresh}
            title={t.common.refresh}
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 xl:p-8 space-y-5">

      {m.error && !m.data ? (
        <div className="text-center py-8">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="typo-body text-red-400">{m.error}</p>
          <button type="button" onClick={m.load} className="mt-2 typo-body text-blue-400 hover:text-blue-300 underline">{t.common.retry}</button>
        </div>
      ) : m.isInitialLoading || !m.data ? (
        <KpiGhosts />
      ) : !hasSeries ? (
        <div className="text-center py-8">
          <TrendingUp className="w-6 h-6 text-foreground mx-auto mb-2" />
          <p className="typo-body text-foreground">{t.overview.activity.no_data}</p>
        </div>
      ) : (
        <div className={SUMMARY_GRID}>
          <KpiTile icon={Zap} label={t.overview.activity.total_executions} color="blue" numericValue={m.data.total_executions} compact language={language} />
          <KpiTile icon={DollarSign} label={t.overview.activity.total_cost} color="violet" numericValue={m.data.total_cost} format={fmtCost} />
          <KpiTile icon={CheckCircle} label={t.overview.activity.success_rate} color="emerald" numericValue={m.overallSuccessRatePct ?? undefined} value="—" format={(v) => `${v.toFixed(1)}%`} />
          <KpiTile icon={Clock} label={t.overview.activity.avg_latency} color="amber" numericValue={m.data.avg_latency_ms} format={fmtMs} />
        </div>
      )}

      {/* Independent lanes start their IPCs on first paint — not after dashboard. */}
      <AthenaUsageSection fleetCost={m.data?.total_cost ?? 0} />
      <LlmSpendSection />
      <ValueRollupSection days={m.days} />
      <ErrorCategorySection days={m.days} />

      {/* Anomalies: the badge opens the drill-down, ids open the detail modal */}
      {hasSeries && m.data && (
        <CostAnomalySection anomalies={m.data.cost_anomalies} onOpenExecution={openExecution} />
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
