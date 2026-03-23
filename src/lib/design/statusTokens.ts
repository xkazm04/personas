/**
 * Unified semantic color token map for status indicators.
 *
 * Single source of truth for all status-related colors across the app.
 * Every status indicator (credentials, health, drift badges, use-case
 * categories, severity styles) should derive its palette from here.
 */

// -- Token shape ---------------------------------------------------------

export interface StatusToken {
  /** Text color class, e.g. "text-emerald-400" */
  text: string;
  /** Background color class, e.g. "bg-emerald-500/10" */
  bg: string;
  /** Border color class, e.g. "border-emerald-500/30" */
  border: string;
  /** Focus ring class, e.g. "focus-visible:ring-emerald-500/40" */
  ring: string;
  /** Icon/dot color class (solid bg), e.g. "bg-emerald-400" */
  icon: string;
}

// -- Core semantic palette -----------------------------------------------

export const STATUS_PALETTE = {
  success: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    ring: 'focus-visible:ring-emerald-500/40',
    icon: 'bg-emerald-400',
  },
  warning: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    ring: 'focus-visible:ring-amber-500/40',
    icon: 'bg-amber-400',
  },
  error: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    ring: 'focus-visible:ring-red-500/40',
    icon: 'bg-red-400',
  },
  info: {
    text: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    ring: 'focus-visible:ring-blue-500/40',
    icon: 'bg-blue-400',
  },
  neutral: {
    text: 'text-muted-foreground/60',
    bg: 'bg-muted/10',
    border: 'border-muted-foreground/15',
    ring: 'focus-visible:ring-muted-foreground/30',
    icon: 'bg-muted-foreground/30',
  },
} as const satisfies Record<string, StatusToken>;

// -- Extended palette (domain-specific semantic slots) --------------------

export const STATUS_PALETTE_EXTENDED = {
  ...STATUS_PALETTE,
  /** AI / violet accent (lab, design, AI-driven actions) */
  ai: {
    text: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
    ring: 'focus-visible:ring-violet-500/40',
    icon: 'bg-violet-400',
  },
  /** Rotation / lifecycle (credential rotation, sync) */
  rotation: {
    text: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/20',
    ring: 'focus-visible:ring-cyan-500/40',
    icon: 'bg-cyan-400',
  },
  /** Critical / high-severity errors (rose variant) */
  critical: {
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/20',
    ring: 'focus-visible:ring-rose-500/40',
    icon: 'bg-rose-400',
  },
  /** Timeout / caution (orange variant) */
  caution: {
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    ring: 'focus-visible:ring-orange-500/40',
    icon: 'bg-orange-400',
  },
} as const satisfies Record<string, StatusToken>;

// -- Convenience type for palette keys -----------------------------------

export type StatusKey = keyof typeof STATUS_PALETTE;
export type StatusKeyExtended = keyof typeof STATUS_PALETTE_EXTENDED;

// -- Severity style helpers (left-border accent) -------------------------

export interface SeverityAccent {
  border: string;
  bg: string;
  text: string;
}

export const SEVERITY_ACCENTS: Record<'error' | 'warning' | 'info' | 'success', SeverityAccent> = {
  error:   { border: 'border-l-[3px] border-l-red-500',     bg: 'bg-red-500/5',     text: STATUS_PALETTE.error.text },
  warning: { border: 'border-l-[3px] border-l-amber-500',   bg: 'bg-amber-500/5',   text: STATUS_PALETTE.warning.text },
  info:    { border: 'border-l-[3px] border-l-blue-500',    bg: 'bg-blue-500/5',    text: STATUS_PALETTE.info.text },
  success: { border: 'border-l-[3px] border-l-emerald-500', bg: 'bg-emerald-500/5', text: STATUS_PALETTE.success.text },
};

// -- StatusColorScale: unified health indicator colors --------------------

export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'info' | 'neutral';

/** Maps semantic health levels to StatusToken entries from STATUS_PALETTE. */
export const HEALTH_STATUS_TOKEN: Record<HealthStatus, StatusToken> = {
  healthy:  STATUS_PALETTE.success,
  warning:  STATUS_PALETTE.warning,
  critical: STATUS_PALETTE.error,
  info:     STATUS_PALETTE.info,
  neutral:  STATUS_PALETTE.neutral,
};

/** Multi-variant class set for a health status indicator. */
export interface StatusColorScale {
  text: string;
  bg: string;
  border: string;
  dot: string;
  line: string;
}

/** Derive a full StatusColorScale from a HealthStatus. */
export function healthScale(status: HealthStatus): StatusColorScale {
  const t = HEALTH_STATUS_TOKEN[status];
  return { text: t.text, bg: t.bg, border: t.border, dot: t.icon, line: `${t.icon}/30` };
}

/** Combined `text + bg + border` classes for a health status (card / badge shorthand). */
export function healthClasses(status: HealthStatus): string {
  const t = HEALTH_STATUS_TOKEN[status];
  return `${t.text} ${t.bg} ${t.border}`;
}

// -- Threshold mappers ----------------------------------------------------

/** Map a success rate (0–1) to a HealthStatus. Thresholds: >=0.99 healthy, >=0.95 warning. */
export function rateToHealth(rate: number): HealthStatus {
  if (rate >= 0.99) return 'healthy';
  if (rate >= 0.95) return 'warning';
  return 'critical';
}

/** Map a latency in ms to a HealthStatus. Thresholds: <50 healthy, <200 info, <1000 warning. */
export function latencyToHealth(ms: number): HealthStatus {
  if (ms < 50) return 'healthy';
  if (ms < 200) return 'info';
  if (ms < 1000) return 'warning';
  return 'critical';
}

/** Map a healing outcome status string to a HealthStatus. */
export function outcomeToHealth(status: string | null): HealthStatus {
  switch (status) {
    case 'auto_healed':
    case 'resolved':
      return 'healthy';
    case 'circuit_breaker':
      return 'critical';
    case 'retrying':
      return 'warning';
    default:
      return 'warning';
  }
}
