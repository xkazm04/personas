import type { PersonaMemoryCategory } from '@/lib/types/frontendTypes';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, XCircle, AlertTriangle, Pause, Clock, Loader2, HelpCircle } from 'lucide-react';

export function formatTimestamp(timestamp: string | null, fallback = '-'): string {
  if (!timestamp) return fallback;
  return new Date(timestamp).toLocaleString();
}

export function formatRelativeTime(
  dateStr: string | null,
  fallback = '-',
  opts?: { dateFallbackDays?: number },
): string {
  if (!dateStr) return fallback;
  const then = new Date(dateStr).getTime();
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
  opts?: { precision?: 2 | 4 | 'auto' },
): string {
  const precision = opts?.precision ?? 2;

  if (usd == null) return precision === 2 ? '$0.00' : '\u2014';
  if (precision === 2) {
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return '<$0.01';
    return `$${usd.toFixed(2)}`;
  }
  if (precision === 4) {
    if (usd < 0.001) return '<$0.001';
    return `$${usd.toFixed(4)}`;
  }
  // 'auto'
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
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
