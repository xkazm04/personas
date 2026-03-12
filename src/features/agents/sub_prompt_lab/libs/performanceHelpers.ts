import { useMemo } from 'react';
import type { PromptPerformancePoint } from '@/lib/bindings/PromptPerformancePoint';

// --- Constants ---------------------------------------------------------------

export const PERIOD_OPTIONS = [7, 14, 30, 60, 90] as const;

export const VERSION_COLORS: Record<string, string> = {
  production: '#10b981',
  experimental: '#f59e0b',
  archived: '#71717a',
};

export const COMPARE_A_COLOR = '#6366f1';
export const COMPARE_B_COLOR = '#ec4899';

export const ANOMALY_LABEL: Record<string, string> = {
  cost: 'Cost spike',
  error_rate: 'Error spike',
  latency: 'Latency spike',
};

// --- Formatters --------------------------------------------------------------

export function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtCost(v: number) {
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export function fmtMs(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

export function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

// --- Computed summaries ------------------------------------------------------

export function useSummaryTotals(points: PromptPerformancePoint[]) {
  return useMemo(() => {
    const totalExecs = points.reduce((s, p) => s + p.total_executions, 0);
    const totalFailed = points.reduce((s, p) => s + p.failed_count, 0);
    const avgCost = totalExecs > 0
      ? points.reduce((s, p) => s + p.avg_cost_usd * p.total_executions, 0) / totalExecs
      : 0;
    const allDurations = points.flatMap(p => [p.p50_duration_ms]);
    const medianLatency = allDurations.length > 0
      ? allDurations.sort((a, b) => a - b)[Math.floor(allDurations.length / 2)] ?? 0
      : 0;
    const errorRate = totalExecs > 0 ? totalFailed / totalExecs : 0;
    const avgTokenRatio = totalExecs > 0
      ? points.reduce((s, p) => s + (p.avg_input_tokens > 0 ? p.avg_output_tokens / p.avg_input_tokens : 0) * p.total_executions, 0) / totalExecs
      : 0;
    return { totalExecs, avgCost, medianLatency, errorRate, avgTokenRatio };
  }, [points]);
}
