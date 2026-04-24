/**
 * Tour surface tokens.
 *
 * Single source of truth for the accent color surfaces used by the onboarding
 * tour (GuidedTour, StepProgress, TourPanelBody). Each surface bundles the
 * Tailwind classes that together make up a themed container: a subtle tinted
 * background, an accent border, an accent text color, and an elevation glow.
 *
 * Tour code should reference `surface.subtle` / `surface.accent` etc. instead
 * of composing raw `bg-violet-500/10` strings at the call site.
 */

export interface TourSurface {
  /** Tinted background fill, e.g. `bg-violet-500/10` */
  subtle: string;
  /** Accent border, e.g. `border-violet-500/25` */
  accent: string;
  /** Accent foreground text, e.g. `text-violet-400` */
  text: string;
  /** Colored drop shadow for elevation, e.g. `shadow-violet-500/10` */
  glow: string;
}

export type TourSurfaceKey =
  | 'violet'
  | 'blue'
  | 'teal'
  | 'indigo'
  | 'amber'
  | 'emerald';

export const TOUR_SURFACES: Record<TourSurfaceKey, TourSurface> = {
  violet:  { subtle: 'bg-violet-500/10',  accent: 'border-violet-500/25',  text: 'text-violet-400',  glow: 'shadow-violet-500/10' },
  blue:    { subtle: 'bg-blue-500/10',    accent: 'border-blue-500/25',    text: 'text-blue-400',    glow: 'shadow-blue-500/10' },
  teal:    { subtle: 'bg-teal-500/10',    accent: 'border-teal-500/25',    text: 'text-teal-400',    glow: 'shadow-teal-500/10' },
  indigo:  { subtle: 'bg-indigo-500/10',  accent: 'border-indigo-500/25',  text: 'text-indigo-400',  glow: 'shadow-indigo-500/10' },
  amber:   { subtle: 'bg-amber-500/10',   accent: 'border-amber-500/25',   text: 'text-amber-400',   glow: 'shadow-amber-500/10' },
  emerald: { subtle: 'bg-emerald-500/10', accent: 'border-emerald-500/25', text: 'text-emerald-400', glow: 'shadow-emerald-500/10' },
};

const DEFAULT_SURFACE: TourSurfaceKey = 'violet';

/** Resolve a surface by key, falling back to the default (violet). */
export function getTourSurface(key: string | undefined | null): TourSurface {
  if (key && key in TOUR_SURFACES) return TOUR_SURFACES[key as TourSurfaceKey];
  return TOUR_SURFACES[DEFAULT_SURFACE];
}
