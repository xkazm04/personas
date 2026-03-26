import { useMemo, useCallback } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { mergePreviousPeriod } from '@/features/overview/sub_usage/libs/periodComparison';
import { pivotToolUsageOverTime } from '@/features/overview/sub_usage/libs/pivotToolUsage';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { formatToolName, formatDateTick } from './analyticsHelpers';
import type { PieDataPoint } from '@/features/overview/sub_observability/components/MetricsCharts';

/**
 * Pure derivation hook -- reads store slices and computes all chart series
 * for the analytics dashboard. No side-effects or fetches.
 */
export function useChartSeries() {
  const {
    observabilityMetrics, executionDashboard, setOverviewTab,
  } = useOverviewStore(useShallow((s) => ({
    observabilityMetrics: s.observabilityMetrics,
    executionDashboard: s.executionDashboard,
    setOverviewTab: s.setOverviewTab,
  })));
  const toolUsageSummary = useAgentStore((s) => s.toolUsageSummary);
  const toolUsageOverTime = useAgentStore((s) => s.toolUsageOverTime);
  const personas = useAgentStore((s) => s.personas);

  const { effectiveDays, compareEnabled } = useOverviewFilterValues();
  const { setFailureDrilldownDate } = useOverviewFilterActions();

  const backendChartData = observabilityMetrics?.chartData;
  const rawChartData = backendChartData?.chart_points ?? [];

  const chartData = useMemo(() => {
    const base = (!compareEnabled || rawChartData.length === 0) ? rawChartData : mergePreviousPeriod(rawChartData, effectiveDays, ['cost', 'executions', 'success', 'failed']);
    return base.map(pt => ({ ...pt, dateLabel: formatDateTick(pt.date) }));
  }, [compareEnabled, rawChartData, effectiveDays]);

  const pieData: PieDataPoint[] = useMemo(() =>
    (backendChartData?.persona_breakdown ?? []).map((b) => ({
      name: personas.find((p) => p.id === b.persona_id)?.name || b.persona_id,
      executions: b.executions,
      cost: b.cost,
    })),
  [backendChartData?.persona_breakdown, personas]);

  const { areaData, allToolNames } = useMemo(() => {
    const pivot = pivotToolUsageOverTime(toolUsageOverTime);
    return {
      areaData: pivot.areaData.map(pt => ({ ...pt, dateLabel: formatDateTick(pt.date) })),
      allToolNames: pivot.allToolNames,
    };
  }, [toolUsageOverTime]);

  const barData = useMemo(
    () => [...toolUsageSummary]
      .sort((a, b) => b.total_invocations - a.total_invocations)
      .map((s) => ({
        name: formatToolName(s.tool_name),
        invocations: s.total_invocations,
        executions: s.unique_executions,
        personas: s.unique_personas,
      })),
    [toolUsageSummary],
  );

  const latencyData = useMemo(() => {
    if (!executionDashboard) return [];
    return executionDashboard.daily_points.map((pt) => ({
      date: pt.date,
      dateLabel: formatDateTick(pt.date),
      p50: pt.p50_duration_ms,
      p95: pt.p95_duration_ms,
      p99: pt.p99_duration_ms,
    }));
  }, [executionDashboard]);

  const handleFailureBarClick = useCallback((data: { date?: string; failed?: number }) => {
    if (!data.date || data.failed === 0) return;
    setFailureDrilldownDate(data.date);
    setOverviewTab('knowledge');
  }, [setFailureDrilldownDate, setOverviewTab]);

  return {
    chartData,
    pieData,
    areaData,
    allToolNames,
    barData,
    latencyData,
    handleFailureBarClick,
  };
}
