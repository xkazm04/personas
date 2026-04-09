import { useMemo, useCallback } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { mergePreviousPeriod } from '@/features/overview/sub_usage/libs/periodComparison';
import { computePeriodTrends } from '@/features/overview/utils/computeTrends';
import { resolveTimeRange, type TimeRange } from '@/lib/types/timeRange';
import { fmtDate } from './executionMetricsHelpers';

type TimeWindow = 1 | 7 | 30 | 90;

export function useExecutionMetrics() {
  const { dayRange, setDayRange, customDateRange, setCustomDateRange, effectiveDays, compareEnabled, setCompareEnabled, previousPeriodDays } = useOverviewFilters();
  const { data, loading, error, fetchExecutionDashboard } = useOverviewStore(useShallow((s) => ({
    data: s.executionDashboard,
    loading: s.executionDashboardLoading,
    error: s.executionDashboardError,
    fetchExecutionDashboard: s.fetchExecutionDashboard,
  })));

  const days: TimeWindow = dayRange;
  const fetchDays = compareEnabled ? previousPeriodDays : effectiveDays;

  const activeRange = useMemo((): TimeRange => {
    if (customDateRange) {
      return { kind: 'custom', startDate: customDateRange[0], endDate: customDateRange[1] };
    }
    return { kind: 'rolling-days', days: effectiveDays };
  }, [customDateRange, effectiveDays]);
  const activeRangeLabel = useMemo(() => resolveTimeRange(activeRange).label, [activeRange]);

  // Lifecycle fetch is handled by useExecutionDashboardPipeline; load is for manual retry.
  const load = useCallback(() => fetchExecutionDashboard(fetchDays), [fetchExecutionDashboard, fetchDays]);

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
        date: fmtDate(pt.date), rawDate: pt.date,
        cost: pt.total_cost, executions: pt.total_executions,
        completed: pt.completed, failed: pt.failed,
        successRate: pt.success_rate * 100,
        p50: pt.p50_duration_ms, p95: pt.p95_duration_ms, p99: pt.p99_duration_ms,
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

  const trends = useMemo(
    () => computePeriodTrends(chartData, effectiveDays, compareEnabled),
    [chartData, effectiveDays, compareEnabled],
  );

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

  return {
    data, loading, error, load,
    days, setDayRange, customDateRange, setCustomDateRange,
    compareEnabled, setCompareEnabled,
    activeRangeLabel,
    chartData, comparedChartData, personaCostData, personaNames,
    anomalyDates, overallSuccessRatePct, trends,
  };
}
