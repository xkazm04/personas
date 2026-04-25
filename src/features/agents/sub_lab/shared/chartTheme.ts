// Brand-palette chart theme for Lab visualizations.
// Resolves Recharts axis/grid/series colors from semantic CSS tokens
// (--primary, --accent, --muted-foreground, --status-error) so charts
// inherit dark/light theme automatically via [data-theme^='...'] overrides.

import { useMemo } from 'react';
import { useThemeStore } from '@/stores/themeStore';

const FALLBACK = {
  primary: '#06b6d4',
  accent: '#22d3ee',
  mutedForeground: '#bcc8d8',
  destructive: '#f87171',
  background: '#0a0e14',
  foreground: '#e2e8f0',
  border: '#1e293b',
  gridStroke: 'rgba(255,255,255,0.06)',
  axisFill: 'rgba(255,255,255,0.4)',
} as const;

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function parseColor(color: string): { r: number; g: number; b: number } | null {
  const t = color.trim();
  if (t.startsWith('#')) {
    const hex = t.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
      };
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(t);
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]! };
  return null;
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

function rgba(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

export interface ChartTheme {
  /** 5-step sequential ramp from primary -> accent for multi-series comparisons. */
  series: readonly [string, string, string, string, string];
  /** Matching low-alpha fills for filled-area marks. */
  seriesFill: readonly [string, string, string, string, string];
  /** Reserved for regressions / negative deltas. Do not use for ordinary series. */
  destructive: string;
  /** Faint grid line stroke. */
  gridStroke: string;
  /** Faint axis tick label fill — derived from --muted-foreground. */
  axisFill: string;
  /** Stronger axis label fill (for primary axis labels). */
  axisLabelFill: string;
  /** Tooltip surface. */
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

export function getChartTheme(): ChartTheme {
  const primary = readVar('--primary', FALLBACK.primary);
  const accent = readVar('--accent', FALLBACK.accent);
  const mutedFg = readVar('--muted-foreground', FALLBACK.mutedForeground);
  const destructive = readVar('--status-error', FALLBACK.destructive);
  const background = readVar('--background', FALLBACK.background);
  const foreground = readVar('--foreground', FALLBACK.foreground);
  const border = readVar('--border', FALLBACK.border);

  const series = [
    primary,
    mix(primary, accent, 0.25),
    mix(primary, accent, 0.5),
    mix(primary, accent, 0.75),
    accent,
  ] as const;

  const seriesFill = [
    rgba(series[0], 0.16),
    rgba(series[1], 0.16),
    rgba(series[2], 0.16),
    rgba(series[3], 0.16),
    rgba(series[4], 0.16),
  ] as const;

  return {
    series,
    seriesFill,
    destructive,
    gridStroke: readVar('--chart-grid-stroke', FALLBACK.gridStroke),
    // Prefer the chart-axis-fill token (already alpha-blended for theme); fall
    // back to muted-foreground at 75% so light themes still get correct contrast.
    axisFill: readVar('--chart-axis-fill', rgba(mutedFg, 0.75)),
    axisLabelFill: rgba(foreground, 0.85),
    tooltipBg: rgba(background, 0.92),
    tooltipBorder: rgba(border, 0.6),
    tooltipText: foreground,
  };
}

/** Pick the n-th series stroke color; wraps if `index` exceeds ramp length. */
export function seriesColor(index: number, theme: ChartTheme = getChartTheme()): string {
  return theme.series[index % theme.series.length]!;
}

/** Pick the n-th series fill color; wraps if `index` exceeds ramp length. */
export function seriesFillColor(index: number, theme: ChartTheme = getChartTheme()): string {
  return theme.seriesFill[index % theme.seriesFill.length]!;
}

/** Reactive hook — recomputes when the active theme changes. */
export function useChartTheme(): ChartTheme {
  const themeId = useThemeStore((s) => s.themeId);
  const customTheme = useThemeStore((s) => s.customTheme);
  // themeId/customTheme are sentinel deps: getChartTheme() reads CSS vars via
  // getComputedStyle, so the call appears side-effect-free to the linter, but
  // we genuinely need to recompute when the active theme changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getChartTheme(), [themeId, customTheme]);
}
