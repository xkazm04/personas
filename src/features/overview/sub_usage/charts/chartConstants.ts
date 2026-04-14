// Shared Recharts styling primitives used across dashboards

export const CHART_COLORS = [
  '#3B82F6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ec4899', '#EA4335', '#4A154B', '#06b6d4',
];

export const CHART_COLORS_PURPLE = [
  '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd',
  '#818cf8', '#7c3aed', '#5b21b6', '#4f46e5',
];

function getCSSVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export const GRID_STROKE_FALLBACK = 'rgba(255,255,255,0.06)';
export const AXIS_TICK_FILL_FALLBACK = 'rgba(255,255,255,0.4)';

/** @deprecated Use {@link getGridStroke} for theme-responsive value */
export const GRID_STROKE = GRID_STROKE_FALLBACK;
/** @deprecated Use {@link getAxisTickFill} for theme-responsive value */
export const AXIS_TICK_FILL = AXIS_TICK_FILL_FALLBACK;

export function getGridStroke(): string {
  return getCSSVar('--chart-grid-stroke', GRID_STROKE_FALLBACK);
}

export function getAxisTickFill(): string {
  return getCSSVar('--chart-axis-fill', AXIS_TICK_FILL_FALLBACK);
}

/**
 * 6-stop chart palette derived from theme CSS variables.
 * Uses --primary, --accent, and brand tokens so the palette adapts to every theme.
 */
export function getThemeChartPalette(): string[] {
  return [
    getCSSVar('--primary', '#06b6d4'),
    getCSSVar('--accent', '#22d3ee'),
    getCSSVar('--brand-purple', '#a78bfa'),
    getCSSVar('--brand-emerald', '#34d399'),
    getCSSVar('--brand-amber', '#fbbf24'),
    getCSSVar('--brand-rose', '#fb7185'),
  ];
}

/** Tooltip style object derived from theme CSS variables. */
export function getTooltipStyle(): React.CSSProperties {
  return {
    background: getCSSVar('--background', '#0a0e14'),
    border: `1px solid ${getCSSVar('--card-border', 'rgba(255,255,255,0.10)')}`,
    borderRadius: 10,
    color: getCSSVar('--foreground', '#e2e8f0'),
  };
}

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
