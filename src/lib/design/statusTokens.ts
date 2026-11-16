/**
 * Unified semantic color token map for status indicators.
 *
 * Single source of truth for all status-related colors across the app, bound to theme tokens
 * (`status-*`, `role-*`, ink) so every theme paints its own; no raw palette hues.
 * Every status indicator (credentials, health, drift badges, use-case
 * categories, severity styles) should derive its palette from here.
 */

// -- Token shape ---------------------------------------------------------

export interface StatusToken {
  /** Text color class, e.g. "text-status-success" */
  text: string;
  /** Background color class, e.g. "bg-status-success/10" */
  bg: string;
  /** Border color class, e.g. "border-status-success/30" */
  border: string;
  /** Focus ring class, e.g. "focus-visible:ring-status-success/40" */
  ring: string;
  /** Icon/dot color class (solid bg), e.g. "bg-status-success" */
  icon: string;
}

// -- Core semantic palette -----------------------------------------------

export const STATUS_PALETTE = {
  success: {
    text: 'text-status-success',
    bg: 'bg-status-success/10',
    border: 'border-status-success/30',
    ring: 'focus-visible:ring-status-success/40',
    icon: 'bg-status-success',
  },
  warning: {
    text: 'text-status-warning',
    bg: 'bg-status-warning/10',
    border: 'border-status-warning/30',
    ring: 'focus-visible:ring-status-warning/40',
    icon: 'bg-status-warning',
  },
  error: {
    text: 'text-status-error',
    bg: 'bg-status-error/10',
    border: 'border-status-error/30',
    ring: 'focus-visible:ring-status-error/40',
    icon: 'bg-status-error',
  },
  info: {
    text: 'text-status-info',
    bg: 'bg-status-info/10',
    border: 'border-status-info/20',
    ring: 'focus-visible:ring-status-info/40',
    icon: 'bg-status-info',
  },
  neutral: {
    text: 'text-ink-1',
    bg: 'bg-surface-2',
    border: 'border-hair-2',
    ring: 'focus-visible:ring-ink-3/30',
    icon: 'bg-ink-3',
  },
} as const satisfies Record<string, StatusToken>;

// -- Extended palette (domain-specific semantic slots) --------------------

export const STATUS_PALETTE_EXTENDED = {
  ...STATUS_PALETTE,
  /** AI / violet accent (lab, design, AI-driven actions) */
  ai: {
    text: 'text-role-agent',
    bg: 'bg-role-agent/10',
    border: 'border-role-agent/20',
    ring: 'focus-visible:ring-role-agent/40',
    icon: 'bg-role-agent',
  },
  /** Rotation / lifecycle (credential rotation, sync) */
  rotation: {
    text: 'text-role-external',
    bg: 'bg-role-external/10',
    border: 'border-role-external/20',
    ring: 'focus-visible:ring-role-external/40',
    icon: 'bg-role-external',
  },
  /** Critical / high-severity errors (rose variant) */
  critical: {
    text: 'text-status-error',
    bg: 'bg-status-error/10',
    border: 'border-status-error/20',
    ring: 'focus-visible:ring-status-error/40',
    icon: 'bg-status-error',
  },
  /** Timeout / caution (orange variant) */
  caution: {
    text: 'text-status-warning',
    bg: 'bg-status-warning/10',
    border: 'border-status-warning/20',
    ring: 'focus-visible:ring-status-warning/40',
    icon: 'bg-status-warning',
  },
} as const satisfies Record<string, StatusToken>;

// -- Convenience type for palette keys -----------------------------------

export type StatusKey = keyof typeof STATUS_PALETTE;
export type StatusKeyExtended = keyof typeof STATUS_PALETTE_EXTENDED;

// -- Settings sidebar / SectionHeading per-domain accents -----------------
//
// One palette slot per settings sub-page. Used by the settings sidebar to
// tint the active item (10% bg + accent icon/border) and by SectionHeading
// to color a page-level icon. Add a new entry whenever a new settings
// sub-page is introduced in `getSettingsItems` (see sidebarData.ts).

export interface SettingsIconAccent {
  /** Icon stroke color, e.g. "text-role-agent" */
  text: string;
  /** Active-state tinted background (10%), e.g. "bg-role-agent/10" */
  bg: string;
  /** Active-state border, e.g. "border-role-agent/30" */
  border: string;
}

export const SETTINGS_ICON_ACCENTS = {
  appearance:      { text: 'text-role-agent',  bg: 'bg-role-agent/10',  border: 'border-role-agent/30' },
  notifications:   { text: 'text-status-warning',   bg: 'bg-status-warning/10',   border: 'border-status-warning/30' },
  engine:          { text: 'text-role-external',    bg: 'bg-role-external/10',    border: 'border-role-external/30' },
  byom:            { text: 'text-status-success', bg: 'bg-status-success/10', border: 'border-status-success/30' },
  portability:     { text: 'text-role-human',  bg: 'bg-role-human/10',  border: 'border-role-human/30' },
  'api-keys':      { text: 'text-role-highlight', bg: 'bg-role-highlight/10', border: 'border-role-highlight/30' },
  admin:           { text: 'text-status-error',    bg: 'bg-status-error/10',    border: 'border-status-error/30' },
  account:         { text: 'text-status-neutral',   bg: 'bg-status-neutral/10',   border: 'border-status-neutral/30' },
} as const satisfies Record<string, SettingsIconAccent>;

export type SettingsIconAccentKey = keyof typeof SETTINGS_ICON_ACCENTS;

/** Look up an accent by settings sub-page id; returns null for unmapped ids (Network, Config Resolution, ...). */
export function getSettingsIconAccent(id: string): SettingsIconAccent | null {
  return (SETTINGS_ICON_ACCENTS as Record<string, SettingsIconAccent>)[id] ?? null;
}

// -- Severity style helpers (left-border accent) -------------------------

export interface SeverityAccent {
  border: string;
  bg: string;
  text: string;
}

export const SEVERITY_ACCENTS: Record<'error' | 'warning' | 'info' | 'success', SeverityAccent> = {
  error:   { border: 'border-l-[3px] border-l-status-error',     bg: 'bg-status-error/5',     text: STATUS_PALETTE.error.text },
  warning: { border: 'border-l-[3px] border-l-status-warning',   bg: 'bg-status-warning/5',   text: STATUS_PALETTE.warning.text },
  info:    { border: 'border-l-[3px] border-l-status-info',    bg: 'bg-status-info/5',    text: STATUS_PALETTE.info.text },
  success: { border: 'border-l-[3px] border-l-status-success', bg: 'bg-status-success/5', text: STATUS_PALETTE.success.text },
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
