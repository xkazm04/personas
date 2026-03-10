// Shared Recharts styling primitives used across dashboards

export const CHART_COLORS = [
  '#3B82F6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ec4899', '#EA4335', '#4A154B', '#06b6d4',
];

export const CHART_COLORS_PURPLE = [
  '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd',
  '#818cf8', '#7c3aed', '#5b21b6', '#4f46e5',
];

export const GRID_STROKE = 'rgba(255,255,255,0.06)';
export const AXIS_TICK_FILL = 'rgba(255,255,255,0.4)';

export const CHART_HEIGHT = { sm: 160, md: 200, lg: 240 } as const;

export type MetricUnit = 'count' | 'tokens' | 'usd' | 'ms' | 'percent';

export const METRIC_UNITS_BY_KEY: Record<string, MetricUnit> = {
  cost: 'usd',
  spend: 'usd',
  p50: 'ms',
  p95: 'ms',
  p99: 'ms',
  latency: 'ms',
  duration_ms: 'ms',
  successRate: 'percent',
  tokens: 'tokens',
  token_count: 'tokens',
  input_tokens: 'tokens',
  output_tokens: 'tokens',
};

export function metricUnitForKey(dataKey: string): MetricUnit {
  return METRIC_UNITS_BY_KEY[dataKey] ?? 'count';
}
