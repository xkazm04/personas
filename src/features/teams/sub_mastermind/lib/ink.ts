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

// The two variants forge their own typographic identities (deliberately NOT the
// app's UI stack): Archipelago = cartographic serif, Command Grid = tactical mono.
export const SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`;
export const MONO = `ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', monospace`;
