import type { PersonaMemoryCategory } from '@/lib/types/frontendTypes';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, XCircle, AlertTriangle, Pause, Clock, Loader2, HelpCircle } from 'lucide-react';

/**
 * SQLite `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" — UTC, but with NO
 * timezone marker, which `new Date()` misreads as LOCAL time (so a row written
 * "now" can read "2h ago" for a UTC+2 viewer). Normalize a bare datetime to
 * explicit UTC; pass through anything already zoned (trailing `Z`/`±HH:MM`).
 */
export function normalizeTimestamp(dateStr: string): string {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(dateStr)
    ? `${dateStr.replace(' ', 'T')}Z`
    : dateStr;
}

export function formatTimestamp(timestamp: string | null, fallback = '-'): string {
  if (!timestamp) return fallback;
  return new Date(normalizeTimestamp(timestamp)).toLocaleString();
}

export function formatRelativeTime(
  dateStr: string | null,
  fallback = '-',
  opts?: { dateFallbackDays?: number },
): string {
  if (!dateStr) return fallback;
  const then = new Date(normalizeTimestamp(dateStr)).getTime();
  if (isNaN(then)) return fallback;
  const now = Date.now();
  const diffSeconds = Math.floor((now - then) / 1000);
  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (opts?.dateFallbackDays != null && diffDays >= opts.dateFallbackDays) {
    return new Date(then).toLocaleDateString();
  }
  return `${diffDays}d ago`;
}

/**
 * Convenience wrapper: relative time with `'Never'` as the null/invalid fallback.
 *
 * Used pervasively in deployment-side UI (last_invoked_at, last_triggered_at,
 * fired_at, etc.) where the absence of a date should read as "never happened"
 * rather than the generic dash. Hoisted here in Wave 5 — was previously
 * redefined inline in 4 different deployment helpers, one of which had drifted
 * to use the bare `'-'` fallback.
 */
export const timeAgo = (iso: string | null): string => formatRelativeTime(iso, 'Never');

/**
 * Format a USD cost with configurable precision.
 *
 * @param usd        The cost in US dollars.
 * @param opts.precision
 *   - `2`  (default): two decimals, `<$0.01` for sub-penny, `$0.00` for null/zero.
 *   - `4`:  four decimals, `<$0.001` for tiny values, `—` for null.
 *   - `'auto'`: adaptive — 4 decimals below $0.01, 3 below $1, 2 otherwise.
 */
export function formatCost(
  usd: number | null | undefined,
  opts?: { precision?: 2 | 4 | 'auto'; language?: string },
): string {
  const precision = opts?.precision ?? 2;
  const language = opts?.language ?? 'en';
  // Costs are USD-denominated (LLM provider currency); only number
  // formatting is locale-aware (decimal separator, grouping). UI callers
  // should pass `language` from useTranslation() so non-English locales
  // see e.g. "0,0042 $" in fr-FR instead of "$0.0042".
  const fmt = (amount: number, digits: number) =>
    new Intl.NumberFormat(language, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);

  if (usd == null) return precision === 2 ? fmt(0, 2) : '\u2014';
  if (precision === 2) {
    if (usd === 0) return fmt(0, 2);
    if (usd < 0.01) return `<${fmt(0.01, 2)}`;
    return fmt(usd, 2);
  }
  if (precision === 4) {
    if (usd < 0.001) return `<${fmt(0.001, 3)}`;
    return fmt(usd, 4);
  }
  // 'auto'
  if (usd < 0.001) return `<${fmt(0.001, 3)}`;
  if (usd < 0.01) return fmt(usd, 4);
  if (usd < 1) return fmt(usd, 3);
  return fmt(usd, 2);
}

// -- Badge color maps ----------------------------------------------------
export interface BadgeColors {
  bg: string;
  text: string;
  border: string;
}

export function badgeClass(colors: BadgeColors): string {
  return `${colors.bg} ${colors.text} border ${colors.border}`;
}

// -- Unified execution status map ----------------------------------------
export interface ExecutionStatusEntry extends BadgeColors {
  label: string;
  icon: LucideIcon;
  pulse?: boolean;
}

export const EXECUTION_STATUS_MAP: Record<string, ExecutionStatusEntry> = {
  queued:     { label: 'Queued',     icon: Clock,         text: 'text-status-neutral',      bg: 'bg-status-neutral/10',    border: 'border-status-neutral/20' },
  running:    { label: 'Running',    icon: Loader2,       text: 'text-status-processing',   bg: 'bg-status-processing/10', border: 'border-status-processing/30', pulse: true },
  completed:  { label: 'Completed',  icon: CheckCircle2,  text: 'text-status-success',      bg: 'bg-status-success/10',    border: 'border-status-success/20' },
  failed:     { label: 'Failed',     icon: XCircle,       text: 'text-status-error',        bg: 'bg-status-error/10',      border: 'border-status-error/20' },
  cancelled:  { label: 'Cancelled',  icon: Pause,         text: 'text-status-warning',      bg: 'bg-status-warning/10',    border: 'border-status-warning/20' },
  incomplete: { label: 'Incomplete', icon: AlertTriangle,  text: 'text-status-warning',      bg: 'bg-status-warning/10',    border: 'border-status-warning/20' },
  unknown:    { label: 'Unknown',    icon: HelpCircle,      text: 'text-neutral-400',         bg: 'bg-neutral-500/10',       border: 'border-neutral-500/20' },
};

/** Fallback entry for unknown/corrupted statuses (gray badge, not red). */
export const DEFAULT_STATUS_ENTRY: ExecutionStatusEntry = EXECUTION_STATUS_MAP.unknown!;

/** Look up a status entry with fallback. */
export function getStatusEntry(status: string): ExecutionStatusEntry {
  return EXECUTION_STATUS_MAP[status] ?? DEFAULT_STATUS_ENTRY;
}


// EVENT_STATUS_COLORS is now re-exported from '@/lib/design/eventTokens' above.

export const SEVERITY_COLORS: Record<string, BadgeColors> = {
  low:      { bg: 'bg-status-info/10',    text: 'text-status-info',    border: 'border-status-info/20' },
  medium:   { bg: 'bg-status-warning/10', text: 'text-status-warning', border: 'border-status-warning/20' },
  high:     { bg: 'bg-status-warning/10', text: 'text-status-warning', border: 'border-status-warning/20' },
  critical: { bg: 'bg-status-error/10',   text: 'text-status-error',   border: 'border-status-error/20' },
};

export const HEALING_CATEGORY_COLORS: Record<string, BadgeColors> = {
  prompt: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  tool: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  config: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  external: { bg: 'bg-gray-500/10', text: 'text-gray-600', border: 'border-gray-500/20' },
};

export interface CategoryColors extends BadgeColors {
  label: string;
  accent: string;
}

export const MEMORY_CATEGORY_COLORS: Record<string, CategoryColors> = {
  fact: { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', accent: 'border-l-blue-500' },
  preference: { label: 'Preference', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', accent: 'border-l-amber-500' },
  instruction: { label: 'Instruction', bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', accent: 'border-l-violet-500' },
  context: { label: 'Context', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', accent: 'border-l-emerald-500' },
  learned: { label: 'Learned', bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', accent: 'border-l-cyan-500' },
  constraint: { label: 'Constraint', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', accent: 'border-l-red-500' },
};

export const TEAM_MEMORY_CATEGORY_COLORS: Record<string, CategoryColors> = {
  observation: { label: 'Observation', bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', accent: 'border-l-cyan-500' },
  decision: { label: 'Decision', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', accent: 'border-l-amber-500' },
  context: { label: 'Context', bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', accent: 'border-l-violet-500' },
  learning: { label: 'Learning', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', accent: 'border-l-emerald-500' },
};

export const DEFAULT_CATEGORY_COLORS: CategoryColors = {
  label: 'Unknown', bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20', accent: 'border-l-gray-500',
};

export const ALL_MEMORY_CATEGORIES = Object.keys(MEMORY_CATEGORY_COLORS) as PersonaMemoryCategory[];

// Re-export event color tokens from the centralized design tokens file.
// All new code should import directly from '@/lib/design/eventTokens'.
export { EVENT_TYPE_COLORS, EVENT_STATUS_COLORS, EVENT_TYPE_FALLBACK, EVENT_STATUS_FALLBACK, getEventTypeColor, getEventStatusColor, getEventColor } from '@/lib/design/eventTokens';
export type { EventTypeColor, EventStatusColor, EventColorResult } from '@/lib/design/eventTokens';

/** Format seconds into a human-readable interval like "1 hour" or "2 hours 30 minutes" */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  return parts.join(' ');
}

/** Format remaining seconds into a compact countdown like "4m 32s" or "1h 23m" */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/**
 * Format an elapsed duration as a human-readable string.
 * - `compact` (default): "30s", "2m 30s", "1h 5m"
 * - `clock`: "MM:SS" or "HH:MM:SS" with zero-padding
 *
 * @param value  The duration value.
 * @param opts   Either a format string (`'compact' | 'clock'`) for backward
 *               compatibility, or an options object `{ unit?, format? }`.
 *               `unit` defaults to `'ms'`; set to `'s'` when the value is in seconds.
 */
export function formatElapsed(
  value: number,
  opts?: 'compact' | 'clock' | { unit?: 'ms' | 's'; format?: 'compact' | 'clock' },
): string {
  const resolved = typeof opts === 'string' ? { format: opts } : opts;
  const { unit = 'ms', format = 'compact' } = resolved ?? {};
  const totalSeconds = unit === 's' ? Math.floor(value) : Math.floor(value / 1000);

  if (format === 'clock') {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
  }
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const rem = totalSeconds % 60;
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

/**
 * Format a percentage with fixed precision so values stay column-aligned.
 *
 * @param value      The percent magnitude. By default this is already a
 *                   percentage (e.g. `42.5` → `"42.5%"`); pass
 *                   `fromRatio: true` when the input is a 0–1 ratio
 *                   (e.g. `0.425` → `"42.5%"`).
 * @param opts.precision  Decimal places (default `1`). Fixed precision is
 *                   intentional — varying decimals make right-aligned
 *                   percent columns ragged.
 * @param opts.language  BCP-47 locale for the decimal separator (default `'en'`).
 */
export function formatPercent(
  value: number | null | undefined,
  opts?: { fromRatio?: boolean; precision?: number; language?: string },
): string {
  if (value == null || Number.isNaN(value)) return '—';
  const { fromRatio = false, precision = 1, language = 'en' } = opts ?? {};
  const ratio = fromRatio ? value : value / 100;
  return new Intl.NumberFormat(language, {
    style: 'percent',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(ratio);
}

/**
 * Format a plain count/quantity with locale-aware thousands grouping.
 * `1234` → `"1,234"` (en) / `"1 234"` (fr). Null/NaN → em dash.
 */
export function formatCount(
  value: number | null | undefined,
  opts?: { language?: string; precision?: number },
): string {
  if (value == null || Number.isNaN(value)) return '—';
  const { language = 'en', precision } = opts ?? {};
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision ?? 2,
  }).format(value);
}

/**
 * Format a count with compact notation (`12.3K`, `4.5M`, `1.2B`) once it grows
 * past the point where a full grouped figure would overflow a fixed-width KPI
 * tile.
 *
 * Below `threshold` (default 10,000) the full grouped number is kept — small
 * counts read more precisely as `1,234` than `1.2K`, and there's no overflow
 * risk yet. At or above the threshold the value collapses to compact notation
 * with at most one fraction digit so the tile width stays constant as the
 * magnitude grows.
 *
 * Always pair this with the exact value as a `title` tooltip so hovering
 * recovers full precision — {@link compactWithTitle} returns both strings, and
 * `<Numeric unit="compact">` / `<AnimatedCounter title>` wire it up for you.
 *
 * Null / NaN render as an em dash.
 */
export function formatCompactNumber(
  value: number | null | undefined,
  opts?: { language?: string; precision?: number; threshold?: number },
): string {
  if (value == null || Number.isNaN(value)) return '—';
  const { language = 'en', precision = 1, threshold = 10_000 } = opts ?? {};
  if (Math.abs(value) < threshold) {
    return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat(language, {
    notation: 'compact',
    maximumFractionDigits: precision,
  }).format(value);
}

/**
 * Compact display string + full-precision grouped string, the canonical pairing
 * for a KPI tile that shows the compact figure and reveals the exact value on
 * hover. `display` feeds the visible glyph; `title` feeds the native tooltip.
 */
export function compactWithTitle(
  value: number | null | undefined,
  opts?: { language?: string; precision?: number; threshold?: number },
): { display: string; title: string } {
  return {
    display: formatCompactNumber(value, opts),
    title: formatCount(value, { language: opts?.language ?? 'en', precision: 0 }),
  };
}

/**
 * Unit kinds understood by {@link formatNumeric} and the `<Numeric>` primitive.
 * - `ms` / `s` — duration (delegates to {@link formatDuration})
 * - `usd`       — US-dollar cost (delegates to {@link formatCost})
 * - `percent`   — percentage magnitude (delegates to {@link formatPercent})
 * - `ratio`     — 0–1 ratio rendered as a percent
 * - `count`     — grouped integer/quantity (delegates to {@link formatCount})
 * - `compact`   — compact-notation count for KPI tiles (delegates to {@link formatCompactNumber})
 * - `plain`     — grouped number, no unit
 */
export type NumericUnit = 'ms' | 's' | 'usd' | 'percent' | 'ratio' | 'count' | 'compact' | 'plain';

/**
 * One entry point for the handful of units that show up on metric surfaces
 * (ms, $, %, counts). Centralizing the unit→string mapping means every KPI
 * tile, table cell, and counter renders the same value the same way, and the
 * `<Numeric>` primitive can format from a raw `value` + `unit` pair.
 */
export function formatNumeric(
  value: number | null | undefined,
  unit: NumericUnit = 'plain',
  opts?: { language?: string; precision?: number },
): string {
  if (value == null || Number.isNaN(value)) return '—';
  const { language, precision } = opts ?? {};
  switch (unit) {
    case 'ms':
      return formatDuration(value, { unit: 'ms' });
    case 's':
      return formatDuration(value, { unit: 's' });
    case 'usd':
      return formatCost(value, { precision: 'auto', language });
    case 'percent':
      return formatPercent(value, { precision, language });
    case 'ratio':
      return formatPercent(value, { fromRatio: true, precision, language });
    case 'compact':
      return formatCompactNumber(value, { language, precision });
    case 'count':
    case 'plain':
    default:
      return formatCount(value, { language, precision });
  }
}

// -- Simple mode helpers ------------------------------------------------

import type { SimpleStatus } from './designTokens';
import { SIMPLE_MODE } from './designTokens';

/**
 * Map a granular status string to one of three simple levels.
 * Used in simple mode to reduce cognitive load.
 */
export function formatSimpleStatus(status: string): { level: SimpleStatus; label: string } {
  const s = status.toLowerCase();
  if (['completed', 'success', 'healthy', 'ready', 'approved', 'active', 'running', 'processed'].includes(s)) {
    return { level: 'good', label: SIMPLE_MODE.STATUS.good.label };
  }
  if (['failed', 'error', 'critical', 'rejected', 'blocked', 'unhealthy'].includes(s)) {
    return { level: 'problem', label: SIMPLE_MODE.STATUS.problem.label };
  }
  return { level: 'warning', label: SIMPLE_MODE.STATUS.warning.label };
}

/**
 * Format a duration as a human-readable string.
 *
 * @param value      The duration value (ms by default, or seconds with `unit: 's'`).
 * @param opts.unit  Input unit — `'ms'` (default) or `'s'`.
 * @param opts.precision  `'integer'` (default) rounds to whole units;
 *                        `'decimal'` uses one decimal place for sub-minute values.
 */
export function formatDuration(
  value: number | null | undefined,
  opts?: { unit?: 'ms' | 's'; precision?: 'integer' | 'decimal' },
): string {
  if (value == null) return '\u2014';
  const { unit = 'ms', precision = 'integer' } = opts ?? {};
  const ms = unit === 's' ? value * 1000 : value;

  if (precision === 'decimal') {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }

  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Shorten a raw `model_used` id for dense table cells.
 *
 * Claude CLI ids carry a `claude-` prefix and often a trailing date stamp
 * (`claude-sonnet-4-20250514` → `sonnet-4`); local/BYOM model names
 * (`gemma4`, `qwen3.5`) pass through unchanged. Returns null when no model
 * was recorded so callers can render their own placeholder.
 */
export function formatModelShort(model: string | null | undefined): string | null {
  if (!model) return null;
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}
