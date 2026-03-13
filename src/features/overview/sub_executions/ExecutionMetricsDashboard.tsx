import { useEffect, useMemo, useCallback } from 'react';
import {
  DollarSign, Zap, CheckCircle, Clock,
  TrendingUp, AlertTriangle,
  Loader2, X, Timer,
} from 'lucide-react';
import { useOverviewStore } from "@/stores/overviewStore";
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { DayRangePicker, CompareToggle } from '@/features/overview/sub_usage/DashboardFilters';
import { mergePreviousPeriod } from '@/features/overview/sub_usage/charts/periodComparison';
import { resolveTimeRange, type TimeRange } from '@/lib/types/timeRange';
import { SummaryCard, AnomalyBadge, fmtCost, fmtMs, fmtDate } from './MetricsSummaryCards';
import { CostPerDayChart, ExecutionsByStatusChart, SuccessRateChart, LatencyChart } from './MetricsCharts';
import { TopPersonasList } from './MetricsSummaryCards';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimeWindow = 1 | 7 | 30 | 90;

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

interface ExecutionMetricsDashboardProps {
  onClose?: () => void;
}

export function ExecutionMetricsDashboard({ onClose }: ExecutionMetricsDashboardProps) {
  const { dayRange, setDayRange, customDateRange, setCustomDateRange, effectiveDays, compareEnabled, setCompareEnabled, previousPeriodDays } = useOverviewFilters();
  const data = useOverviewStore((s) => s.executionDashboard);
  const loading = useOverviewStore((s) => s.executionDashboardLoading);
  const error = useOverviewStore((s) => s.executionDashboardError);
  const fetchExecutionDashboard = useOverviewStore((s) => s.fetchExecutionDashboard);

  const days: TimeWindow = dayRange;
  const fetchDays = compareEnabled ? previousPeriodDays : effectiveDays;

  const activeRange = useMemo((): TimeRange => {
    if (customDateRange) {
      return { kind: 'custom', startDate: customDateRange[0], endDate: customDateRange[1] };
    }
    return { kind: 'rolling-days', days: effectiveDays };
  }, [customDateRange, effectiveDays]);
  const activeRangeLabel = useMemo(() => resolveTimeRange(activeRange).label, [activeRange]);

  const load = useCallback(() => fetchExecutionDashboard(fetchDays), [fetchExecutionDashboard, fetchDays]);

  useEffect(() => { load(); }, [load]);

  // Build chart-ready arrays + per-persona cost breakdown in a single pass
  const { chartData, personaCostData, personaNames } = useMemo(() => {
    if (!data) return { chartData: [], personaCostData: [], personaNames: [] as string[] };

    const totalCostByPersona = new Map<string, number>();
    for (const pt of data.daily_points) {
      for (const pc of pt.persona_costs) {
        totalCostByPersona.set(pc.persona_name, (totalCostByPersona.get(pc.persona_name) || 0) + pc.cost);
      }
    }

    const sorted = Array.from(totalCostByPersona.entries()).sort((a, b) => b[1] - a[1]);
    const top8 = new Set(sorted.slice(0, 8).map(([name]) => name));
    const hasOther = sorted.length > 8;

    const chartRows: Array<Record<string, string | number>> = [];
    const personaCostRows: Array<Record<string, string | number>> = [];

    for (const pt of data.daily_points) {
      chartRows.push({
        date: fmtDate(pt.date),
        rawDate: pt.date,
        cost: pt.total_cost,
        executions: pt.total_executions,
        completed: pt.completed,
        failed: pt.failed,
        successRate: pt.success_rate * 100,
        p50: pt.p50_duration_ms,
        p95: pt.p95_duration_ms,
        p99: pt.p99_duration_ms,
      });

      const row: Record<string, string | number> = { date: fmtDate(pt.date) };
      let otherCost = 0;
      for (const pc of pt.persona_costs) {
        if (top8.has(pc.persona_name)) {
          row[pc.persona_name] = pc.cost;
        } else {
          otherCost += pc.cost;
        }
      }
      if (otherCost > 0) row['Other'] = otherCost;
      personaCostRows.push(row);
    }

    const names = sorted.slice(0, 8).map(([name]) => name);
    if (hasOther) names.push('Other');

    return { chartData: chartRows, personaCostData: personaCostRows, personaNames: names };
  }, [data]);

  const comparedChartData = useMemo(() => {
    if (!compareEnabled || chartData.length === 0) return chartData;
    return mergePreviousPeriod(chartData, effectiveDays, ['cost', 'completed', 'failed', 'successRate', 'p50', 'p95', 'p99']);
  }, [compareEnabled, chartData, effectiveDays]);

  const anomalyDates = useMemo(
    () => new Set(data?.cost_anomalies.map((a) => fmtDate(a.date)) ?? []),
    [data],
  );

  const overallSuccessRatePct = useMemo(
    () => resolveMetricPercent(
      SUCCESS_RATE_IDENTITIES.executionDashboardSummary,
      { ratio: data?.overall_success_rate ?? 0 },
    ),
    [data],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 text-primary/60 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={load} className="mt-2 text-sm text-blue-400 hover:text-blue-300 underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!data || data.daily_points.length === 0) {
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
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-foreground/90">Execution Metrics</h3>
          <DayRangePicker value={days} onChange={setDayRange} customDateRange={customDateRange} onCustomDateRangeChange={setCustomDateRange} />
          <CompareToggle enabled={compareEnabled} onChange={setCompareEnabled} />
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-500/8 border border-blue-500/15 text-[11px] text-blue-400/70">
            <Timer className="w-3 h-3" />
            {activeRangeLabel}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Zap} label="Total Executions" value={data.total_executions.toLocaleString()} color="blue" />
        <SummaryCard icon={DollarSign} label="Total Cost" value={fmtCost(data.total_cost)} color="violet" />
        <SummaryCard icon={CheckCircle} label="Success Rate" value={`${overallSuccessRatePct.toFixed(1)}%`} color="emerald" />
        <SummaryCard icon={Clock} label="Avg Latency" value={fmtMs(data.avg_latency_ms)} color="amber" />
      </div>

      {/* Cost Anomaly Alerts */}
      {data.cost_anomalies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-amber-400/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Cost Anomalies Detected
          </h4>
          {data.cost_anomalies.map((a, i) => (
            <AnomalyBadge key={i} anomaly={a} />
          ))}
        </div>
      )}

      {/* Cost Forecasting Panel */}
      {data.projected_monthly_cost != null && data.burn_rate != null && (
        <div className="flex flex-col gap-3 p-5 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <h4 className="text-base font-semibold text-foreground/90">Cost Forecasting</h4>
          </div>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-bold tracking-tight text-foreground">{fmtCost(data.projected_monthly_cost)}</p>
              <p className="text-sm text-muted-foreground/80 mt-1">Projected end-of-month spend</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Based on 7-day trailing burn rate of {fmtCost(data.burn_rate)}/day
              </p>
            </div>
            <div className="flex-1 max-w-xs space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground/70">Current Spend</span>
                <span className="font-medium">{fmtCost(data.total_cost)}</span>
              </div>
              <div className="h-2.5 bg-secondary/40 rounded-full overflow-hidden flex relative">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${Math.min(100, (data.total_cost / Math.max(0.01, data.projected_monthly_cost)) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <CostPerDayChart
        personaCostData={personaCostData}
        personaNames={personaNames}
        chartData={chartData}
        anomalyDates={anomalyDates}
        burnRate={data.burn_rate}
      />

      <ExecutionsByStatusChart data={comparedChartData} compareEnabled={compareEnabled} />
      <SuccessRateChart data={comparedChartData} compareEnabled={compareEnabled} />
      <LatencyChart data={comparedChartData} compareEnabled={compareEnabled} />

      <TopPersonasList personas={data.top_personas} />
    </div>
  );
}
