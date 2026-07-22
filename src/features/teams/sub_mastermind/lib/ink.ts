// Mastermind ink — every colour flows through the semantic theme tokens so all
// switchable themes (incl. the pre-darkened light skins) render correctly.
// Never paint with raw hex here.
import type { DimStatus, IslandState } from './types';

export const STATE_INK: Record<IslandState, string> = {
  healthy: 'var(--status-success)',
  building: 'var(--status-info)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-error)',
};

export const DIM_INK: Record<DimStatus, string> = {
  absent: 'var(--status-neutral)',
  solid: 'var(--status-success)',
  partial: 'var(--status-info)',
  risk: 'var(--status-warning)',
  alert: 'var(--status-error)',
};

/** Fleet session state → ink. Mirrors the Fleet grid's accent palette
 *  (FleetGridPage STATE_ACCENT); violet/indigo have no semantic token yet so
 *  they stay literal, matching the fleet feature's own identity. */
export const FLEET_INK: Record<string, string> = {
  spawning: 'var(--accent)',
  running: 'var(--status-processing)',
  awaiting_input: '#a78bfa',
  idle: 'var(--status-success)',
  stale: 'var(--status-warning)',
  hibernated: '#818cf8',
  exited: 'var(--status-neutral)',
};

/** Score → ink, mirroring the passport ramp (80+ success / 60+ info / 40+ warning / else error). */
export function scoreInkVar(score: number): string {
  if (score >= 80) return 'var(--status-success)';
  if (score >= 60) return 'var(--status-info)';
  if (score >= 40) return 'var(--status-warning)';
  return 'var(--status-error)';
}

export const mix = (color: string, pct: number, base = 'transparent'): string =>
  `color-mix(in srgb, ${color} ${pct}%, ${base})`;

// The canvas forges its own typographic identity (deliberately NOT the app's
// UI stack): cartographic serif for identity/details, mono for instrumentation.
export const SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`;
export const MONO = `ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', monospace`;
