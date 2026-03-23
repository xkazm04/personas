import { TrendingUp, AlertTriangle, X, Zap, DollarSign, CheckCircle, Clock, Timer } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { DayRangePicker } from '@/features/overview/sub_usage/components/DayRangePicker';
import { CompareToggle } from '@/features/overview/sub_usage/components/PersonaSelect';
import { useExecutionMetrics } from '../libs/useExecutionMetrics';
import { fmtCost, fmtMs } from '../libs/executionMetricsHelpers';
import { SUMMARY_GRID } from '@/features/overview/utils/dashboardGrid';
import { SummaryCard, AnomalyBadge } from './MetricsCards';
import { MetricsCharts } from './MetricsCharts';

interface ExecutionMetricsDashboardProps {
  onClose?: () => void;
}

export function ExecutionMetricsDashboard({ onClose }: ExecutionMetricsDashboardProps) {
  const m = useExecutionMetrics();

  if (m.loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <LoadingSpinner size="xl" className="text-primary/60" />
      </div>
    );
  }

  if (m.error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-400">{m.error}</p>
          <button onClick={m.load} className="mt-2 text-sm text-blue-400 hover:text-blue-300 underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!m.data || m.data.daily_points.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <TrendingUp className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground/70">No execution data for the selected period</p>
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
          <h3 className="typo-heading text-foreground/90">Execution Metrics</h3>
          <DayRangePicker value={m.days} onChange={m.setDayRange} customDateRange={m.customDateRange} onCustomDateRangeChange={m.setCustomDateRange} />
          <CompareToggle enabled={m.compareEnabled} onChange={m.setCompareEnabled} />
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-500/8 border border-blue-500/15 text-[11px] text-blue-400/70">
            <Timer className="w-3 h-3" />
            {m.activeRangeLabel}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className={SUMMARY_GRID}>
        <SummaryCard icon={Zap} label="Total Executions" value={m.data.total_executions.toLocaleString()} color="blue" numericValue={m.data.total_executions} formatFn={(v) => Math.round(v).toLocaleString()} />
        <SummaryCard icon={DollarSign} label="Total Cost" value={fmtCost(m.data.total_cost)} color="violet" numericValue={m.data.total_cost} formatFn={fmtCost} />
        <SummaryCard icon={CheckCircle} label="Success Rate" value={`${m.overallSuccessRatePct.toFixed(1)}%`} color="emerald" numericValue={m.overallSuccessRatePct} formatFn={(v) => `${v.toFixed(1)}%`} />
        <SummaryCard icon={Clock} label="Avg Latency" value={fmtMs(m.data.avg_latency_ms)} color="amber" numericValue={m.data.avg_latency_ms} formatFn={fmtMs} />
      </div>

      {/* Anomalies */}
      {m.data.cost_anomalies.length > 0 && (
        <div className="space-y-2">
          <h4 className="typo-heading text-amber-400/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Cost Anomalies Detected
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
