import type { PersonaMemoryCategory } from '@/lib/types/frontendTypes';

export function formatTimestamp(timestamp: string | null, fallback = '-'): string {
  if (!timestamp) return fallback;
  return new Date(timestamp).toLocaleString();
}

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
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

// ── Badge color maps ────────────────────────────────────────────────────
export interface BadgeColors {
  bg: string;
  text: string;
  border: string;
}

export function badgeClass(colors: BadgeColors): string {
  return `${colors.bg} ${colors.text} border ${colors.border}`;
}

export const EXECUTION_STATUS_COLORS: Record<string, BadgeColors> = {
  queued: { bg: 'bg-secondary/60', text: 'text-muted-foreground/60', border: 'border-primary/15' },
  pending: { bg: 'bg-secondary/60', text: 'text-muted-foreground/60', border: 'border-primary/15' },
  running: { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
  completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  failed: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/20' },
  cancelled: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
};

export const EVENT_STATUS_COLORS: Record<string, BadgeColors> = {
  pending: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  processing: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  processed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  skipped: { bg: 'bg-secondary/50', text: 'text-muted-foreground/50', border: 'border-primary/10' },
};

export const SEVERITY_COLORS: Record<string, BadgeColors> = {
  low: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
};

export const HEALING_CATEGORY_COLORS: Record<string, BadgeColors> = {
  prompt: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  tool: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  config: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  external: { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' },
};

export const MEMORY_CATEGORY_COLORS: Record<string, BadgeColors & { label: string }> = {
  fact: { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  preference: { label: 'Preference', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  instruction: { label: 'Instruction', bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  context: { label: 'Context', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  learned: { label: 'Learned', bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  custom: { label: 'Custom', bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' },
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
