// Shared Recharts styling primitives used across dashboards

// ── Shared SVG gradient IDs ─────────────────────────────────────────
// These IDs are defined once by <ChartGradientDefs /> (mounted in App)
// and referenced via `fill={`url(#${CHART_GRAD.cost})`}` in any chart.
export const CHART_GRAD = {
  cost:    'chart-grad-cost',
  traffic: 'chart-grad-traffic',
  error:   'chart-grad-error',
  success: 'chart-grad-success',
} as const;

export const CHART_COLORS = [
  '#3B82F6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ec4899', '#EA4335', '#4A154B', '#06b6d4',
];

function getCSSVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const GRID_STROKE_FALLBACK = 'rgba(255,255,255,0.06)';
const AXIS_TICK_FILL_FALLBACK = 'rgba(255,255,255,0.4)';

export function getGridStroke(): string {
  return getCSSVar('--chart-grid-stroke', GRID_STROKE_FALLBACK);
}

export function getAxisTickFill(): string {
  return getCSSVar('--chart-axis-fill', AXIS_TICK_FILL_FALLBACK);
}

export type MetricUnit = 'count' | 'tokens' | 'usd' | 'ms' | 'percent';

const METRIC_UNITS_BY_KEY: Record<string, MetricUnit> = {
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
