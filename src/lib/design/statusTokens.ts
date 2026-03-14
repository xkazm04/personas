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
