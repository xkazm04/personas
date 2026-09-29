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
  // Muted amber-grey — "data unavailable", deliberately distinct from the plain
  // neutral of `absent` so an unknown cell never reads as an honest zero.
  unknown: 'color-mix(in srgb, var(--status-warning) 32%, var(--status-neutral))',
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

export const mix = (color: string, pct: number, base = 'transparent'): string =>
  `color-mix(in srgb, ${color} ${pct}%, ${base})`;

// Mono for instrumentation (the Fleet preview's terminal lines).
export const MONO = `ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', monospace`;
