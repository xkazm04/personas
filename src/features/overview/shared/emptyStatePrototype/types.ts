import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Prototype scaffold for Overview empty states (/prototype run 2026-05-24).
 *
 * Each module's empty state is rendered through {@link EmptyStateVariantHost},
 * which tab-switches between two *directional* variants:
 *   - Motion        — framer-motion + SVG + lucide animated "coded illustration"
 *   - Illustration  — a dominant Leonardo-generated hero image as the focal point
 *
 * Both variants consume the same {@link EmptyStateContent}, so call sites pass
 * their existing i18n copy + store-action CTAs once. The accent palette is
 * derived from the {@link EmptyStateMotif}, keeping one source of truth.
 *
 * This whole folder is throwaway-by-design: at consolidation the winning
 * variant per module replaces the host and the loser is deleted.
 */

export type EmptyStateMotif =
  | 'activity'
  | 'approval'
  | 'messages'
  | 'knowledge'
  | 'memories'
  | 'leaderboard';

export type EmptyStateVariant = 'motion' | 'illustration';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

/** Tailwind class fragments for a module's accent, derived from its motif. */
export interface EmptyStateAccent {
  /** Foreground for icons / SVG strokes, e.g. `text-primary`. */
  text: string;
  /** Soft fill used behind the motif and as glow, e.g. `bg-primary/10`. */
  soft: string;
  /** Border tint for chips / frames, e.g. `border-primary/20`. */
  border: string;
  /** Raw CSS color string for SVG stroke/fill (theme-adaptive via var). */
  stroke: string;
  /** Radial-glow color stop for the illustration hero halo. */
  glow: string;
}

export interface EmptyStateContent {
  /** Fallback lucide glyph (used by Illustration placeholder + as a small badge). */
  icon: LucideIcon;
  title: string;
  subtitle: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** Extra node rendered under the CTAs (e.g. Knowledge's wiki-vs-vector note). */
  children?: ReactNode;
}

/** Accent palette per motif. Uses semantic tokens; SVG colors use CSS vars so they track the theme. */
export const MOTIF_ACCENTS: Record<EmptyStateMotif, EmptyStateAccent> = {
  activity: {
    text: 'text-primary',
    soft: 'bg-primary/10',
    border: 'border-primary/20',
    stroke: 'var(--primary)',
    glow: 'color-mix(in srgb, var(--primary) 45%, transparent)',
  },
  approval: {
    text: 'text-status-success',
    soft: 'bg-status-success/10',
    border: 'border-status-success/20',
    stroke: 'var(--status-success)',
    glow: 'color-mix(in srgb, var(--status-success) 42%, transparent)',
  },
  messages: {
    text: 'text-status-info',
    soft: 'bg-status-info/10',
    border: 'border-status-info/20',
    stroke: 'var(--status-info)',
    glow: 'color-mix(in srgb, var(--status-info) 42%, transparent)',
  },
  knowledge: {
    text: 'text-violet-400',
    soft: 'bg-violet-500/10',
    border: 'border-violet-500/20',
    stroke: '#a78bfa',
    glow: 'color-mix(in srgb, #a78bfa 45%, transparent)',
  },
  memories: {
    text: 'text-fuchsia-400',
    soft: 'bg-fuchsia-500/10',
    border: 'border-fuchsia-500/20',
    stroke: '#e879f9',
    glow: 'color-mix(in srgb, #e879f9 42%, transparent)',
  },
  leaderboard: {
    text: 'text-amber-400',
    soft: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    stroke: '#fbbf24',
    glow: 'color-mix(in srgb, #fbbf24 45%, transparent)',
  },
};

export interface MotifProps {
  accent: EmptyStateAccent;
  /** Square render size in px (the SVG scales to this). */
  size?: number;
}
