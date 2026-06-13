import { useTranslation } from '@/i18n/useTranslation';
import { TrendingUp, AlertTriangle, X, Zap, DollarSign, CheckCircle, Clock, Timer, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { DayRangePicker } from '@/features/overview/sub_usage/components/DayRangePicker';
import { CompareToggle } from '@/features/overview/sub_usage/components/PersonaSelect';
import { useExecutionMetrics } from '../libs/useExecutionMetrics';
import { fmtCost, fmtMs } from '../libs/executionMetricsHelpers';
import { SUMMARY_GRID } from '@/features/overview/libs/dashboardGrid';
import { AnomalyBadge } from './MetricsCards';
import { KpiTile } from '@/features/overview/components/shared/KpiTile';
import { MetricsCharts } from './MetricsCharts';
import { ValueRollupSection } from './ValueRollupSection';
import { AthenaUsageSection } from './AthenaUsageSection';

interface ExecutionMetricsDashboardProps {
  onClose?: () => void;
}

export function ExecutionMetricsDashboard({ onClose }: ExecutionMetricsDashboardProps) {
  const { t, language } = useTranslation();
  const m = useExecutionMetrics();

  // Stale-while-revalidate: only block on a cold fetch. A refetch over
  // already-rendered data keeps the dashboard visible; the header shows a
  // subtle refresh pip via `m.isRefreshing` below.
  if (m.isInitialLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <LoadingSpinner size="xl" className="text-primary/60" />
      </div>
    );
  }

  if (m.error && !m.data) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="typo-body text-red-400">{m.error}</p>
          <button onClick={m.load} className="mt-2 typo-body text-blue-400 hover:text-blue-300 underline">{t.common.retry}</button>
        </div>
      </div>
    );
  }

  if (!m.data || m.data.daily_points.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <TrendingUp className="w-6 h-6 text-foreground mx-auto mb-2" />
          <p className="typo-body text-foreground">{t.overview.activity.no_data}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 xl:p-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <h3 className="typo-heading text-foreground/90">{t.overview.activity.execution_metrics}</h3>
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
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-card text-foreground hover:text-muted-foreground hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className={SUMMARY_GRID}>
        <KpiTile icon={Zap} label={t.overview.activity.total_executions} color="blue" numericValue={m.data.total_executions} compact language={language} />
        <KpiTile icon={DollarSign} label={t.overview.activity.total_cost} color="violet" numericValue={m.data.total_cost} format={fmtCost} />
        <KpiTile icon={CheckCircle} label={t.overview.activity.success_rate} color="emerald" numericValue={m.overallSuccessRatePct} format={(v) => `${v.toFixed(1)}%`} />
        <KpiTile icon={Clock} label={t.overview.activity.avg_latency} color="amber" numericValue={m.data.avg_latency_ms} format={fmtMs} />
      </div>

      {/* Athena's own usage lane — what the assistant costs, by action type */}
      <AthenaUsageSection fleetCost={m.data.total_cost} />

      {/* Business-value rollup (value-delivered rate, cost-per-value, outcomes) */}
      <ValueRollupSection days={m.days} />

      {/* Anomalies */}
      {m.data.cost_anomalies.length > 0 && (
        <div className="space-y-2">
          <h4 className="typo-heading text-amber-400/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> {t.overview.activity.cost_anomalies}
          </h4>
          {m.data.cost_anomalies.map((a, i) => (
            <AnomalyBadge key={i} anomaly={a} />
          ))}
        </div>
      )}

      <MetricsCharts
        data={m.data}
        comparedChartData={m.comparedChartData}
        personaCostData={m.personaCostData}
        personaNames={m.personaNames}
        chartData={m.chartData}
        anomalyDates={m.anomalyDates}
        compareEnabled={m.compareEnabled}
      />
    </div>
  );
}
