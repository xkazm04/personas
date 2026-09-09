// Per-variant palettes for the 3D prototypes. WebGL materials take literal
// colours (a CSS custom property cannot reach a shader uniform), so every hex
// in the worlds lives HERE and nowhere else. The same palette is mirrored onto
// the HUD as CSS variables (see WorldCanvas) so the DOM overlay and the world
// always agree.
//
// ROUND 2 — FROSTED, NOT NEON. The first pass lit every surface with an
// emissive material and stacked additive glow sprites on top, which is how it
// arrived at a look the operator read as "neon/shiny". Colour alone was not
// the cause and desaturating alone would not have fixed it: a surface that
// emits its own light has no shading, so it cannot read as a material at all.
// The fix is two-sided and both sides live in this file —
//   • the ramps below are chalky (mid-lightness, low saturation) rather than
//     saturated at full value, and the grounds are lifted off pure black so a
//     translucent surface has something to sit against;
//   • `frost` carries the SURFACE contract — high roughness, near-zero
//     emissive, a little clearcoat — which both worlds pass straight into
//     their materials. Tune frostiness here, once, for both.
//
// The brief frees these prototypes from the app's semantic tokens; a middle
// ground with the product theme is a decision for after one of them wins.
import type { DimStatus, IslandState } from '../lib/types';

export type WorldVariant = 'strata' | 'holo';

/** How a surface in this world is made. Read straight into the meshes. */
export interface FrostProfile {
  /** Diffuse roughness — high is the whole point; 0.2 is the neon look. */
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Emissive intensity for a LIT cell. Kept near zero so light comes from
   *  the scene and the cell still has shading. */
  emissive: number;
  /** Emissive for an absent/inert cell. */
  emissiveMuted: number;
  /** Opacity of the big translucent slabs (decks, platforms). */
  slab: number;
  /** Peak opacity of a halo sprite. Round 1 ran these at 0.5–0.9. */
  halo: number;
}

export interface WorldPalette {
  id: WorldVariant;
  /** Scene clear colour. */
  bg: string;
  /** Fog colour (null = no fog). */
  fog: string | null;
  /** The world's own hue — rings, spokes, chrome lines. */
  primary: string;
  /** Counter-accent for "needs you" / Athena's pointer. */
  accent: string;
  /** HUD text. */
  text: string;
  textDim: string;
  /** Floor / grid line ink. */
  grid: string;
  /** Section lines on the floor grid. */
  gridSection: string;
  /** Body colour of the big translucent slabs. */
  glass: string;
  /** Solid structural parts (plinths, platform bodies). */
  structure: string;
  status: Record<DimStatus, string>;
  state: Record<IslandState, string>;
  fleet: Record<'running' | 'awaiting_input' | 'idle' | 'stale', string>;
  frost: FrostProfile;
  /** HUD typography — the variant's own voice. */
  fontDisplay: string;
  fontMono: string;
  /** Uppercase + tracking for display text? */
  displayCaps: boolean;
}

/** Strata — the Stark table, frosted: sand and graphite, dusty teal counter. */
export const STRATA: WorldPalette = {
  id: 'strata',
  bg: '#101216',
  fog: '#101216',
  primary: '#c9a67a',
  accent: '#8fb3bd',
  text: '#ece7df',
  textDim: '#9a9186',
  grid: '#22252b',
  gridSection: '#33302a',
  glass: '#b9a88f',
  structure: '#191c22',
  status: {
    solid: '#8fbfa0',
    partial: '#93aec9',
    risk: '#d3b177',
    alert: '#cc8080',
    unknown: '#8b8579',
    absent: '#3d4149',
  },
  state: { healthy: '#8fbfa0', building: '#93aec9', warning: '#d3b177', critical: '#cc8080' },
  fleet: { running: '#8fb3bd', awaiting_input: '#b3a3cc', idle: '#8fbfa0', stale: '#d3b177' },
  frost: { roughness: 0.82, metalness: 0.06, clearcoat: 0.3, clearcoatRoughness: 0.65, emissive: 0.1, emissiveMuted: 0.02, slab: 0.14, halo: 0.18 },
  fontDisplay: `Bahnschrift, 'Segoe UI Variable Display', 'DIN Alternate', 'Segoe UI', Arial, sans-serif`,
  fontMono: `'Cascadia Mono', Consolas, 'SF Mono', ui-monospace, monospace`,
  displayCaps: true,
};

/** Holo — the projection table, frosted: ice on slate, pale gold accent. */
export const HOLO: WorldPalette = {
  id: 'holo',
  bg: '#080b0d',
  fog: '#080b0d',
  primary: '#8fc2cc',
  accent: '#d9c08a',
  text: '#dfeaee',
  textDim: '#7d949b',
  grid: '#16282e',
  gridSection: '#1d353c',
  glass: '#9fc4cc',
  structure: '#0d161a',
  status: {
    solid: '#86c2a3',
    partial: '#8fabcc',
    risk: '#ccae76',
    alert: '#cc8489',
    unknown: '#87908a',
    absent: '#27383d',
  },
  state: { healthy: '#86c2a3', building: '#8fabcc', warning: '#ccae76', critical: '#cc8489' },
  fleet: { running: '#8fc2cc', awaiting_input: '#b3a8cc', idle: '#86c2a3', stale: '#ccae76' },
  frost: { roughness: 0.78, metalness: 0.04, clearcoat: 0.35, clearcoatRoughness: 0.6, emissive: 0.12, emissiveMuted: 0.03, slab: 0.16, halo: 0.2 },
  fontDisplay: `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`,
  fontMono: `ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', monospace`,
  displayCaps: false,
};

export const PALETTES: Record<WorldVariant, WorldPalette> = { strata: STRATA, holo: HOLO };

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
