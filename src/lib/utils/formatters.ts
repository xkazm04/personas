import type { PersonaMemoryCategory } from '@/lib/types/frontendTypes';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, XCircle, AlertTriangle, Pause, Clock, Loader2 } from 'lucide-react';

export function formatTimestamp(timestamp: string | null, fallback = '-'): string {
  if (!timestamp) return fallback;
  return new Date(timestamp).toLocaleString();
}

export function formatRelativeTime(dateStr: string | null, fallback = '-'): string {
  if (!dateStr) return fallback;
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return fallback;
  const diffSeconds = Math.floor((now - then) / 1000);
  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
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
};

/** Fallback entry for unknown statuses. */
export const DEFAULT_STATUS_ENTRY: ExecutionStatusEntry = EXECUTION_STATUS_MAP.failed!;

/** Look up a status entry with fallback. */
export function getStatusEntry(status: string): ExecutionStatusEntry {
  return EXECUTION_STATUS_MAP[status] ?? DEFAULT_STATUS_ENTRY;
}

/**
 * @deprecated Use EXECUTION_STATUS_MAP or getStatusEntry() instead.
 * Kept for backward compatibility -- derives BadgeColors from the canonical map.
 */
export const EXECUTION_STATUS_COLORS: Record<string, BadgeColors> = (() => {
  const map: Record<string, BadgeColors> = {};
  for (const [k, v] of Object.entries(EXECUTION_STATUS_MAP)) {
    map[k] = { bg: v.bg, text: v.text, border: v.border };
  }
  // Legacy alias
  map.pending = map.queued!;
  return map;
})();

export const EVENT_STATUS_COLORS: Record<string, BadgeColors> = {
  pending:    { bg: 'bg-status-pending/10',    text: 'text-status-pending',    border: 'border-status-pending/20' },
  processing: { bg: 'bg-status-processing/10', text: 'text-status-processing', border: 'border-status-processing/20' },
  completed:  { bg: 'bg-status-success/10',    text: 'text-status-success',    border: 'border-status-success/20' },
  processed:  { bg: 'bg-status-success/10',    text: 'text-status-success',    border: 'border-status-success/20' },
  failed:     { bg: 'bg-status-error/10',      text: 'text-status-error',      border: 'border-status-error/20' },
  skipped:    { bg: 'bg-status-neutral/10',    text: 'text-status-neutral',    border: 'border-status-neutral/20' },
};

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

export const MEMORY_CATEGORY_COLORS: Record<string, BadgeColors & { label: string }> = {
  fact: { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  preference: { label: 'Preference', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  instruction: { label: 'Instruction', bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  context: { label: 'Context', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  learned: { label: 'Learned', bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  custom: { label: 'Custom', bg: 'bg-gray-500/10', text: 'text-gray-600', border: 'border-gray-500/20' },
};

export const ALL_MEMORY_CATEGORIES = Object.keys(MEMORY_CATEGORY_COLORS) as PersonaMemoryCategory[];

export interface EventTypeColor {
  tailwind: string;
  hex: string;
}

export const EVENT_TYPE_COLORS: Record<string, EventTypeColor> = {
  webhook_received: { tailwind: 'text-blue-400', hex: '#60a5fa' },
  execution_completed: { tailwind: 'text-emerald-400', hex: '#34d399' },
  persona_action: { tailwind: 'text-purple-400', hex: '#a78bfa' },
  credential_event: { tailwind: 'text-amber-400', hex: '#fbbf24' },
  task_created: { tailwind: 'text-cyan-400', hex: '#22d3ee' },
  custom: { tailwind: 'text-primary', hex: '#818cf8' },
  // Deployment lifecycle events
  deploy_started: { tailwind: 'text-sky-400', hex: '#38bdf8' },
  deploy_succeeded: { tailwind: 'text-green-400', hex: '#4ade80' },
  deploy_failed: { tailwind: 'text-red-400', hex: '#f87171' },
  deploy_paused: { tailwind: 'text-orange-400', hex: '#fb923c' },
  deploy_resumed: { tailwind: 'text-teal-400', hex: '#2dd4bf' },
  agent_undeployed: { tailwind: 'text-rose-400', hex: '#fb7185' },
  credential_provisioned: { tailwind: 'text-yellow-400', hex: '#facc15' },
};

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
 * Format an elapsed millisecond count as a human-readable duration.
 * - `compact` (default): "30s", "2m 30s", "1h 5m"
 * - `clock`: "MM:SS" or "HH:MM:SS" with zero-padding
 */
export function formatElapsed(ms: number, format: 'compact' | 'clock' = 'compact'): string {
  const totalSeconds = Math.floor(ms / 1000);
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

export function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
