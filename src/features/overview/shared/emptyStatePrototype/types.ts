import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Overview empty-state variant system.
 *
 * Each module's empty state renders one of two presentational variants,
 * decided per module during the /prototype run (2026-05-24):
 *   - {@link MotionEmptyState}        — framer-motion + SVG + lucide motif
 *   - {@link IllustrationEmptyState}  — a Leonardo-generated hero image
 *
 * Winners: Motion → activity / knowledge / memories; Illustration → approval /
 * messages / leaderboard. The motif union is split accordingly so each
 * component only accepts the motifs it can render. Both variants consume the
 * same {@link EmptyStateContent} and derive their accent from the motif.
 */

/** Motifs rendered by the animated-SVG variant. */
export type MotionMotif = 'activity' | 'knowledge' | 'memories';
/** Motifs rendered by the Leonardo-hero variant. */
export type IllustrationMotif = 'approval' | 'messages' | 'leaderboard';
export type EmptyStateMotif = MotionMotif | IllustrationMotif;

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

/** Tailwind class fragments + raw colors for a module's accent, derived from its motif. */
export interface EmptyStateAccent {
  /** Foreground for icons / SVG strokes, e.g. `text-primary`. */
  text: string;
  /** Soft fill used behind the motif and as glow, e.g. `bg-primary/10`. */
  soft: string;
  /** Border tint for chips / frames, e.g. `border-primary/20`. */
  border: string;
  /** Raw SVG stroke/fill color for the dark theme. */
  stroke: string;
  /** Darker SVG stroke/fill color for the light theme (contrast on white). */
  strokeLight: string;
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

/** Accent palette per motif. SVG colors use a dark + light pair so motifs keep contrast across themes. */
export const MOTIF_ACCENTS: Record<EmptyStateMotif, EmptyStateAccent> = {
  activity: {
    text: 'text-primary',
    soft: 'bg-primary/10',
    border: 'border-primary/20',
    stroke: 'var(--primary)',
    strokeLight: '#0e7490', // cyan-700
    glow: 'color-mix(in srgb, var(--primary) 45%, transparent)',
  },
  approval: {
    text: 'text-status-success',
    soft: 'bg-status-success/10',
    border: 'border-status-success/20',
    stroke: 'var(--status-success)',
    strokeLight: '#047857', // emerald-700
    glow: 'color-mix(in srgb, var(--status-success) 42%, transparent)',
  },
  messages: {
    text: 'text-status-info',
    soft: 'bg-status-info/10',
    border: 'border-status-info/20',
    stroke: 'var(--status-info)',
    strokeLight: '#1d4ed8', // blue-700
    glow: 'color-mix(in srgb, var(--status-info) 42%, transparent)',
  },
  knowledge: {
    text: 'text-violet-400',
    soft: 'bg-violet-500/10',
    border: 'border-violet-500/20',
    stroke: '#a78bfa',
    strokeLight: '#7c3aed', // violet-600
    glow: 'color-mix(in srgb, #a78bfa 45%, transparent)',
  },
  memories: {
    text: 'text-fuchsia-400',
    soft: 'bg-fuchsia-500/10',
    border: 'border-fuchsia-500/20',
    stroke: '#e879f9',
    strokeLight: '#c026d3', // fuchsia-600
    glow: 'color-mix(in srgb, #e879f9 42%, transparent)',
  },
  leaderboard: {
    text: 'text-amber-400',
    soft: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    stroke: '#fbbf24',
    strokeLight: '#b45309', // amber-700
    glow: 'color-mix(in srgb, #fbbf24 45%, transparent)',
  },
};

export interface MotifProps {
  accent: EmptyStateAccent;
  /** Square render size in px (the SVG scales to this). */
  size?: number;
}
