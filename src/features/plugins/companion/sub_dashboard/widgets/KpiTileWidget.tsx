import { useEffect } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { WidgetProps } from '../widgetRegistry';

/**
 * KPI tile — a single number with a label and optional unit.
 *
 * Athena-facing config:
 *   {
 *     "metric": "executions" | "cost_total" | "success_rate" | "avg_latency_ms",
 *     "days": 7,        // window
 *     "unit": "$"       // optional prefix unit
 *   }
 *
 * Defaults: metric=executions, days=7. Unrecognized metric = "—".
 */
export function KpiTileWidget({ config, title }: WidgetProps) {
  const days = (config?.days as number) ?? 7;
  const metric = (config?.metric as string) ?? 'executions';
  const unit = (config?.unit as string) ?? '';

  const { data, fetchExecutionDashboard } = useOverviewStore(
    useShallow((s) => ({
      data: s.executionDashboard,
      fetchExecutionDashboard: s.fetchExecutionDashboard,
    })),
  );

  useEffect(() => {
    fetchExecutionDashboard(days);
  }, [days, fetchExecutionDashboard]);

  const value = computeKpi(data, metric);
  const label = title ?? metricLabel(metric);

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col justify-between">
      <div className="typo-caption text-foreground uppercase tracking-wide">{label}</div>
      <div className="typo-h2 font-semibold text-foreground tabular-nums mt-2">
        {value === null ? '—' : `${unit}${value}`}
      </div>
      <div className="typo-caption text-foreground mt-1">last {days}d</div>
    </div>
  );
}

function metricLabel(metric: string): string {
  switch (metric) {
    case 'executions': return 'Executions';
    case 'cost_total': return 'Total cost';
    case 'success_rate': return 'Success rate';
    case 'avg_latency_ms': return 'Avg latency';
    default: return metric;
  }
}

function computeKpi(
  data: ReturnType<typeof useOverviewStore.getState>['executionDashboard'],
  metric: string,
): string | null {
  if (!data) return null;
  const points = data.daily_points || [];
  switch (metric) {
    case 'executions': {
      const total = points.reduce((s, p) => s + (p.total_executions || 0), 0);
      return total.toLocaleString();
    }
    case 'cost_total': {
      const total = points.reduce((s, p) => s + (p.total_cost || 0), 0);
      return total.toFixed(2);
    }
    case 'success_rate': {
      const ratio = data.overall_success_rate ?? 0;
      return `${(ratio * 100).toFixed(1)}%`;
    }
    case 'avg_latency_ms': {
      const valid = points.filter((p) => (p.p50_duration_ms || 0) > 0);
      if (!valid.length) return '0';
      const avg = valid.reduce((s, p) => s + (p.p50_duration_ms || 0), 0) / valid.length;
      return `${Math.round(avg)} ms`;
    }
    default:
      return null;
  }
}
