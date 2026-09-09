// Per-variant palettes for the 3D prototypes. WebGL materials take literal
// colours (a CSS custom property cannot reach a shader uniform), so every hex
// in the three worlds lives HERE and nowhere else. The same palette is mirrored
// onto the HUD as CSS variables (see WorldCanvas) so the DOM overlay and the
// world always agree.
//
// The brief explicitly frees these prototypes from the app's semantic tokens —
// the worlds are auditioning a future-tech look, and a middle ground with the
// product theme is a decision for AFTER one of them wins.
import type { DimStatus, IslandState } from '../lib/types';

export type WorldVariant = 'orbit' | 'strata' | 'holo';

export interface WorldPalette {
  id: WorldVariant;
  /** Scene clear colour. */
  bg: string;
  /** Fog colour (null = no fog). */
  fog: string | null;
  /** The world's own hue — rings, spokes, chrome lines. */
  primary: string;
  /** Warm counter-accent for "needs you" / Athena's pointer. */
  accent: string;
  /** HUD text. */
  text: string;
  textDim: string;
  /** Floor / grid line ink. */
  grid: string;
  status: Record<DimStatus, string>;
  state: Record<IslandState, string>;
  fleet: Record<'running' | 'awaiting_input' | 'idle' | 'stale', string>;
  /** HUD typography — the variant's own voice. */
  fontDisplay: string;
  fontMono: string;
  /** Uppercase + tracking for display text? */
  displayCaps: boolean;
}

/** Orbit — a constellation. Cold cyan on deep space, high-saturation status. */
export const ORBIT: WorldPalette = {
  id: 'orbit',
  bg: '#04060e',
  fog: null,
  primary: '#5fe3ff',
  accent: '#ff9f6b',
  text: '#e6f6ff',
  textDim: '#7f97ad',
  grid: '#12203a',
  status: { solid: '#52f2a8', partial: '#5fb0ff', risk: '#ffc45c', alert: '#ff5c7a', unknown: '#9a8d7a', absent: '#38425a' },
  state: { healthy: '#52f2a8', building: '#5fb0ff', warning: '#ffc45c', critical: '#ff5c7a' },
  fleet: { running: '#5fe3ff', awaiting_input: '#c7a6ff', idle: '#52f2a8', stale: '#ffc45c' },
  fontDisplay: `'Segoe UI Variable Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`,
  fontMono: `'Cascadia Code', 'JetBrains Mono', Consolas, ui-monospace, monospace`,
  displayCaps: true,
};

/** Strata — the Stark HUD. Amber on graphite, a cyan counterpoint. */
export const STRATA: WorldPalette = {
  id: 'strata',
  bg: '#0a0c10',
  fog: '#0a0c10',
  primary: '#ffb347',
  accent: '#7fdfff',
  text: '#fff3e0',
  textDim: '#a08f74',
  grid: '#2a2418',
  status: { solid: '#7bf1a8', partial: '#7fbfff', risk: '#ffc857', alert: '#ff5e5e', unknown: '#8c8272', absent: '#3a3630' },
  state: { healthy: '#7bf1a8', building: '#7fbfff', warning: '#ffc857', critical: '#ff5e5e' },
  fleet: { running: '#7fdfff', awaiting_input: '#d3a6ff', idle: '#7bf1a8', stale: '#ffc857' },
  fontDisplay: `Bahnschrift, 'Segoe UI Variable Display', 'DIN Alternate', 'Segoe UI', Arial, sans-serif`,
  fontMono: `'Cascadia Mono', Consolas, 'SF Mono', ui-monospace, monospace`,
  displayCaps: true,
};

/** Holo — the projection table. Monochrome cyan on black, serif identity. */
export const HOLO: WorldPalette = {
  id: 'holo',
  bg: '#020304',
  fog: '#020304',
  primary: '#22d3ee',
  accent: '#f5c451',
  text: '#dffaff',
  textDim: '#5d8f9c',
  grid: '#0a2a33',
  status: { solid: '#34d399', partial: '#60a5fa', risk: '#fbbf24', alert: '#f87171', unknown: '#7d8a80', absent: '#163038' },
  state: { healthy: '#34d399', building: '#60a5fa', warning: '#fbbf24', critical: '#f87171' },
  fleet: { running: '#22d3ee', awaiting_input: '#c4b5fd', idle: '#34d399', stale: '#fbbf24' },
  fontDisplay: `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`,
  fontMono: `ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', monospace`,
  displayCaps: false,
};

export const PALETTES: Record<WorldVariant, WorldPalette> = { orbit: ORBIT, strata: STRATA, holo: HOLO };

/** Palette → CSS custom properties for the HUD layer. */
export function paletteVars(p: WorldPalette): Record<string, string> {
  return {
    '--w-bg': p.bg,
    '--w-primary': p.primary,
    '--w-accent': p.accent,
    '--w-text': p.text,
    '--w-text-dim': p.textDim,
    '--w-solid': p.status.solid,
    '--w-partial': p.status.partial,
    '--w-risk': p.status.risk,
    '--w-alert': p.status.alert,
    '--w-unknown': p.status.unknown,
    '--w-absent': p.status.absent,
    '--w-font-display': p.fontDisplay,
    '--w-font-mono': p.fontMono,
    '--w-caps': p.displayCaps ? 'uppercase' : 'none',
    '--w-tracking': p.displayCaps ? '0.18em' : '0.02em',
  };
}
