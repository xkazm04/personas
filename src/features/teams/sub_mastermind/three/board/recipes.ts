// Design recipes for the Strata board — the vocabulary the operator points at.
//
// A recipe is every knob that decides how the Strata world LOOKS, in one plain
// object, so a variant is a line of data rather than a fork of the scene. The
// board renders each recipe into the same two frames (L0 portfolio, L1 one
// project exploded) and lays them out as a contact sheet; the operator names
// cells, and the next board is bred from the winners.
//
// Discipline: a board varies AT MOST TWO axes and holds the rest. Nine cells
// on one axis pair is what an eye can compare; nine cells on five axes is
// noise. Board 1 below is material family × ground tone. Everything else —
// ramp, light, edges — is held at the shipped Strata values, and the shipped
// look itself is cell b1-0 so there is an anchor to compare against.
//
// Names and notes are developer vocabulary rendered in mono as identifiers,
// like project slugs and tool names; they are not product copy and change
// every round, so they are deliberately not routed through i18n.
import type { DimStatus, IslandState } from '../../lib/types';
import { STRATA, type FrostProfile, type WorldPalette } from '../palettes';

export type MaterialFamily = 'clay' | 'frosted' | 'ceramic' | 'glass';
export type FloorKind = 'grid' | 'plane' | 'none';
export type EnvKind = 'none' | 'soft' | 'studio';
export type ToneMode = 'aces' | 'neutral' | 'none';
/** Which colour an outline takes: the cell's own status colour, one neutral
 *  ink, the world's primary hue, or no outlines at all. */
export type EdgeTint = 'own' | 'neutral' | 'primary' | 'off';

export interface DesignRecipe {
  /** Short and stable — what the operator points at ("b1-4"). */
  id: string;
  /** Developer vocabulary, mono, untranslated. */
  name: string;
  /** The axis values this cell holds, for the sheet label. */
  axes: Record<string, string>;
  ground: {
    bg: string;
    fog: boolean;
    floor: FloorKind;
    /** Grid inks, or the plane colour when floor = plane. */
    grid: string;
    section: string;
  };
  light: {
    ambient: number;
    key: number;
    keyColor: string;
    fill: number;
    fillColor: string;
    env: EnvKind;
    tone: ToneMode;
    exposure: number;
  };
  /** The surface contract — read straight into the physical materials. */
  surface: FrostProfile & {
    /** Tiles fully opaque (clay, ceramic) or translucent (frosted, glass). */
    opaqueTiles: boolean;
    /** Glass only — light passes through. */
    transmission: number;
  };
  edges: {
    tint: EdgeTint;
    weight: number;
    neutral: string;
  };
  ramp: {
    primary: string;
    accent: string;
    glass: string;
    structure: string;
    status: Record<DimStatus, string>;
    state: Record<IslandState, string>;
  };
  finish: {
    /** Contact-shadow opacity; 0 = no shadows at all. */
    contactShadow: number;
    shadowBlur: number;
    /** Corner radius on tiles; 0 = sharp boxes. */
    bevel: number;
  };
}

// ── The shipped look, as a recipe, so the board has an anchor ───────────────

const STRATA_RAMP: DesignRecipe['ramp'] = {
  primary: STRATA.primary,
  accent: STRATA.accent,
  glass: STRATA.glass,
  structure: STRATA.structure,
  status: STRATA.status,
  state: STRATA.state,
};

/** Exactly what the Strata tab ships today. Changing this changes the product
 *  tab; the board is where a change gets CHOSEN before it lands here. */
export const STRATA_RECIPE: DesignRecipe = {
  id: 'b1-0',
  name: 'current',
  axes: { material: 'frosted', ground: 'shipped' },
  ground: { bg: STRATA.bg, fog: true, floor: 'grid', grid: STRATA.grid, section: STRATA.gridSection },
  light: { ambient: 0.55, key: 1.15, keyColor: '#fff0da', fill: 0.4, fillColor: '#9fb6c4', env: 'soft', tone: 'aces', exposure: 1 },
  surface: { ...STRATA.frost, opaqueTiles: false, transmission: 0 },
  edges: { tint: 'own', weight: 0.6, neutral: '#6b6f78' },
  ramp: STRATA_RAMP,
  finish: { contactShadow: 0, shadowBlur: 2, bevel: 0 },
};

// ── Board 1: material family × ground tone ──────────────────────────────────
//
// Held constant across the nine: the shipped ramp, a warm key + cool fill,
// NEUTRAL tone mapping (the filmic default crushes exactly the soft tones the
// operator asked for), contact shadows ON, and a small bevel. Shadows and tone
// mapping are the two changes I believe the "dulling" pass was missing — a
// desaturated scene with nothing grounding it reads as flat, not calm — so the
// whole board carries them and cell b1-0 is the without.

const MATERIALS: Record<Exclude<MaterialFamily, 'glass'>, DesignRecipe['surface']> = {
  clay: {
    roughness: 0.96, metalness: 0, clearcoat: 0, clearcoatRoughness: 1,
    emissive: 0, emissiveMuted: 0, slab: 0.5, halo: 0.05,
    opaqueTiles: true, transmission: 0,
  },
  frosted: {
    ...STRATA.frost,
    opaqueTiles: false, transmission: 0,
  },
  ceramic: {
    roughness: 0.42, metalness: 0.02, clearcoat: 0.85, clearcoatRoughness: 0.22,
    emissive: 0.04, emissiveMuted: 0.01, slab: 0.32, halo: 0.1,
    opaqueTiles: true, transmission: 0,
  },
};

const GROUNDS: Record<'charcoal' | 'graphite' | 'slate', DesignRecipe['ground']> = {
  charcoal: { bg: '#0b0c0f', fog: true, floor: 'grid', grid: '#191b20', section: '#24272d' },
  graphite: { bg: '#15181d', fog: true, floor: 'grid', grid: '#23272e', section: '#30353d' },
  slate: { bg: '#1d232a', fog: true, floor: 'grid', grid: '#2b333c', section: '#38424c' },
};

const BOARD1_LIGHT: DesignRecipe['light'] = {
  ambient: 0.6, key: 1.1, keyColor: '#fff1dd', fill: 0.45, fillColor: '#a9bfcf', env: 'soft', tone: 'neutral', exposure: 1,
};

const BOARD1_FINISH: DesignRecipe['finish'] = { contactShadow: 0.55, shadowBlur: 2.2, bevel: 0.05 };

function cell(n: number, material: keyof typeof MATERIALS, ground: keyof typeof GROUNDS): DesignRecipe {
  return {
    id: `b1-${n}`,
    name: `${material} / ${ground}`,
    axes: { material, ground },
    ground: GROUNDS[ground],
    light: BOARD1_LIGHT,
    surface: MATERIALS[material],
    edges: { tint: 'own', weight: 0.6, neutral: '#6b6f78' },
    ramp: STRATA_RAMP,
    finish: BOARD1_FINISH,
  };
}

export const BOARD_1: DesignRecipe[] = [
  STRATA_RECIPE,
  cell(1, 'clay', 'charcoal'),
  cell(2, 'clay', 'graphite'),
  cell(3, 'clay', 'slate'),
  cell(4, 'frosted', 'charcoal'),
  cell(5, 'frosted', 'graphite'),
  cell(6, 'frosted', 'slate'),
  cell(7, 'ceramic', 'charcoal'),
  cell(8, 'ceramic', 'graphite'),
  cell(9, 'ceramic', 'slate'),
];

/** The board the app renders. Swap this when breeding the next round. */
export const CURRENT_BOARD = BOARD_1;

/** The axis names a board varies — derived, so the sheet header cannot drift
 *  from the recipes. */
export function boardAxes(board: DesignRecipe[]): string[] {
  const keys = new Set<string>();
  for (const r of board) for (const k of Object.keys(r.axes)) keys.add(k);
  return [...keys];
}

/**
 * A recipe as the palette the scene components already read. The scene keeps
 * consuming `palette.*` and `palette.frost.*`; the recipe is the authoring
 * surface and this is the seam between them.
 */
export function recipeToPalette(r: DesignRecipe): WorldPalette {
  return {
    ...STRATA,
    bg: r.ground.bg,
    fog: r.ground.fog ? r.ground.bg : null,
    primary: r.ramp.primary,
    accent: r.ramp.accent,
    grid: r.ground.grid,
    gridSection: r.ground.section,
    glass: r.ramp.glass,
    structure: r.ramp.structure,
    status: r.ramp.status,
    state: r.ramp.state,
    frost: {
      roughness: r.surface.roughness,
      metalness: r.surface.metalness,
      clearcoat: r.surface.clearcoat,
      clearcoatRoughness: r.surface.clearcoatRoughness,
      emissive: r.surface.emissive,
      emissiveMuted: r.surface.emissiveMuted,
      slab: r.surface.slab,
      halo: r.surface.halo,
    },
  };
}
