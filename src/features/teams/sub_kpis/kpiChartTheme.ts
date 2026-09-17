// The one chart vocabulary for sub_kpis (registry: encoding-vocabulary). Every
// recharts surface in this folder spreads these instead of re-typing the axis
// stroke, grid, tooltip box and target line — so the KPI charts read as one
// system and a token change lands everywhere.
import type { CSSProperties } from 'react';

export const AXIS_PROPS = {
  stroke: 'var(--muted-foreground)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

export const GRID_PROPS = {
  stroke: 'var(--secondary)',
  strokeOpacity: 0.5,
  vertical: false,
} as const;

export const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
};

/** The 100 %-of-target reference line shared by every normalized chart. */
export const TARGET_LINE_PROPS = {
  y: 100,
  stroke: 'var(--status-success)',
  strokeDasharray: '4 3',
} as const;

/** Simulated / composed series are drawn dashed — the pixel says how the
 *  number was made. */
export const SIMULATED_DASH = '6 4';

/** Shared panel chrome for chart sections (border, tint, recharts focus resets). */
export const CHART_PANEL_CLASS =
  'rounded-card border border-primary/15 bg-secondary/10 p-4 [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none [&_svg]:outline-none';

/** The 45° hatch that marks UNMEASURED area — it can never read as a fill. */
export const HATCH_BG =
  'repeating-linear-gradient(45deg, color-mix(in srgb, var(--muted-foreground) 28%, transparent) 0 4px, transparent 4px 8px)';

/** Band tint at a coverage-scaled intensity: 18 % floor so a barely-covered
 *  cell still shows its hue, 70 % ceiling so text stays legible. */
export function bandFill(color: string, coverage: number): string {
  const pct = Math.round(18 + 52 * Math.max(0, Math.min(1, coverage)));
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/** Opacity for a cell that does not match the active highlight (pof grammar). */
export const DIMMED_OPACITY = 0.22;
