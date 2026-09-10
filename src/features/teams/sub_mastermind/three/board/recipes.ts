// Design recipes for the Strata board — the vocabulary the operator points at.
//
// A recipe is every knob that decides how the Strata world LOOKS and how a
// project is SHAPED, in one plain object, so a variant is a line of data
// rather than a fork of the scene. The board renders each recipe into the
// frames it asks for and lays them out as a contact sheet; the operator names
// cells, and the next board is bred from the winners.
//
// BOARD 3, and what the two rounds before it taught, in the operator's words:
// round 1 was "the same picture in a different tone"; round 2 "the same design
// of structure, but applied colour palettes degrading the design — pastel and
// neon are bad directions". So this board splits the two things a recipe can
// change and varies ONE of them per group:
//   A. three recipes keep the STRUCTURE and go for REALISTIC materials — real
//      metal, glass, concrete under plausible light, no outlines — in Strata's
//      own hues, toned down (the test asserts every status hue stays within
//      25° of the shipped one and no more saturated);
//   B. three recipes keep the shipped PALETTE and change what a project IS at
//      L0: a simple named node with relationship lanes, no dimensions in
//      sight, which opens into the full stack on the way to L1.
//
// Names and notes are developer vocabulary rendered in mono as identifiers;
// they are not product copy and change every round, so they are deliberately
// not routed through i18n.
import type { DimStatus, IslandState } from '../../lib/types';
import { STRATA, type FrostProfile, type WorldPalette } from '../palettes';

export type SurfaceMode = 'physical' | 'flat' | 'wire';
export type DeckStyle = 'slab' | 'solid' | 'frame' | 'none';
export type FloorKind = 'grid' | 'plane' | 'mirror' | 'none';
export type EnvKind = 'none' | 'soft' | 'studio';
export type ToneMode = 'aces' | 'neutral' | 'none';
export type EdgeTint = 'own' | 'neutral' | 'primary' | 'off';
export type StatusPlacement = 'fill' | 'cap';
/** What a project is at L0. `stack` = the collapsed decks the product ships;
 *  the others hide the dimensions inside one simple body that opens on L1. */
export type NodeShape = 'stack' | 'slab' | 'disc' | 'card';
/** How a relationship is drawn between two projects. */
export type LaneStyle = 'dash' | 'ribbon' | 'arc';

export interface DesignRecipe {
  /** Short and stable — what the operator points at ("b3-4"). */
  id: string;
  /** Developer vocabulary, mono, untranslated. */
  name: string;
  /** One line on the idea, for the sheet label. */
  note: string;
  ground: {
    bg: string;
    fog: boolean;
    floor: FloorKind;
    /** Grid inks, or the plane / mirror colour. */
    grid: string;
    section: string;
    /** Mirror floors only: 0 = matte plane, 1 = full mirror. */
    mirror: number;
  };
  light: {
    ambient: number;
    key: number;
    keyColor: string;
    keyFrom: [number, number, number];
    fill: number;
    fillColor: string;
    env: EnvKind;
    tone: ToneMode;
    exposure: number;
  };
  surface: FrostProfile & {
    mode: SurfaceMode;
    opaqueTiles: boolean;
    bodyColor: string;
    attentionGlow: number;
  };
  deck: {
    style: DeckStyle;
    color: string;
    opacity: number;
    /** Real glass: light passes through (physical mode only). */
    transmission: number;
    /** Deck material overrides — a deck is often a different material from a tile. */
    roughness: number;
    metalness: number;
  };
  node: {
    l0: NodeShape;
    lanes: LaneStyle;
  };
  edges: {
    tint: EdgeTint;
    weight: number;
    neutral: string;
  };
  ramp: {
    primary: string;
    accent: string;
    structure: string;
    status: Record<DimStatus, string>;
    state: Record<IslandState, string>;
  };
  finish: {
    contactShadow: number;
    shadowBlur: number;
    bevel: number;
    statusAs: StatusPlacement;
  };
}

/** A board: which recipes, judged in which frames (0 = portfolio, 1 = one
 *  project exploded). */
export interface Board {
  id: string;
  frames: Array<0 | 1>;
  recipes: DesignRecipe[];
}

// ── The shipped look, as a recipe ───────────────────────────────────────────

const STRATA_RAMP: DesignRecipe['ramp'] = {
  primary: STRATA.primary,
  accent: STRATA.accent,
  structure: STRATA.structure,
  status: STRATA.status,
  state: STRATA.state,
};

/** Exactly what the Strata tab ships today. Changing this changes the product
 *  tab; the board is where a change gets CHOSEN before it lands here. */
export const STRATA_RECIPE: DesignRecipe = {
  id: 'current',
  name: 'current',
  note: 'the shipped Strata look',
  ground: { bg: STRATA.bg, fog: true, floor: 'grid', grid: STRATA.grid, section: STRATA.gridSection, mirror: 0 },
  light: { ambient: 0.55, key: 1.15, keyColor: '#fff0da', keyFrom: [14, 22, 10], fill: 0.4, fillColor: '#9fb6c4', env: 'soft', tone: 'aces', exposure: 1 },
  surface: { ...STRATA.frost, mode: 'physical', opaqueTiles: false, bodyColor: '#ffffff', attentionGlow: 0 },
  deck: { style: 'slab', color: STRATA.glass, opacity: STRATA.frost.slab, transmission: 0, roughness: STRATA.frost.roughness, metalness: STRATA.frost.metalness },
  node: { l0: 'stack', lanes: 'dash' },
  edges: { tint: 'own', weight: 0.6, neutral: '#6b6f78' },
  ramp: STRATA_RAMP,
  finish: { contactShadow: 0, shadowBlur: 2, bevel: 0, statusAs: 'fill' },
};

// ── Group A: realistic materials, Strata hues toned down ────────────────────
//
// Held: the shipped structure (stack + dashed lanes), no outlines — real
// objects do not have them — contact shadows, a studio-ish environment so
// metal and glass have something to reflect, filmic tone mapping.

/** Strata's status hues, darkened and desaturated for painted metal. */
const RAMP_PAINTED: DesignRecipe['ramp'] = {
  ...STRATA_RAMP,
  status: { solid: '#6f9a80', partial: '#6f8ea8', risk: '#b8985f', alert: '#a86a6a', unknown: '#6f6c66', absent: '#34383f' },
  state: { healthy: '#6f9a80', building: '#6f8ea8', warning: '#b8985f', critical: '#a86a6a' },
  structure: '#1a1d22',
};
/** Strata's hues as sandstone — a little warmer, a little chalkier. */
const RAMP_STONE: DesignRecipe['ramp'] = {
  ...STRATA_RAMP,
  status: { solid: '#7fa78c', partial: '#7f97ad', risk: '#c2a06a', alert: '#b57676', unknown: '#7d7870', absent: '#3a3e45' },
  state: { healthy: '#7fa78c', building: '#7f97ad', warning: '#c2a06a', critical: '#b57676' },
  structure: '#23262b',
};
/** Strata's hues pulled toward brass — same hue family, metal value. */
const RAMP_BRASS: DesignRecipe['ramp'] = {
  ...STRATA_RAMP,
  status: { solid: '#7c9a7e', partial: '#7e8fa1', risk: '#c9a468', alert: '#b07068', unknown: '#75706a', absent: '#383b41' },
  state: { healthy: '#7c9a7e', building: '#7e8fa1', warning: '#c9a468', critical: '#b07068' },
  structure: '#2a2724',
};

const NO_EDGES: DesignRecipe['edges'] = { tint: 'off', weight: 0, neutral: '#000000' };

/** A1. ANODISED GRAPHITE — dark anodised aluminium decks, matte painted-metal
 *  tiles, a faintly reflective dark floor. Studio light. */
const ANODISED: DesignRecipe = {
  id: 'b3-1',
  name: 'anodised graphite',
  note: 'A · dark anodised decks, painted-metal tiles, faint floor reflection',
  ground: { bg: '#101216', fog: true, floor: 'mirror', grid: '#15181c', section: '#15181c', mirror: 0.25 },
  light: { ambient: 0.35, key: 1.5, keyColor: '#fff0da', keyFrom: [12, 20, 10], fill: 0.55, fillColor: '#9fb6c4', env: 'studio', tone: 'aces', exposure: 1 },
  surface: { roughness: 0.62, metalness: 0.35, clearcoat: 0.25, clearcoatRoughness: 0.5, emissive: 0, emissiveMuted: 0, slab: 1, halo: 0, mode: 'physical', opaqueTiles: true, bodyColor: '#ffffff', attentionGlow: 0 },
  deck: { style: 'solid', color: '#2a2d33', opacity: 1, transmission: 0, roughness: 0.32, metalness: 0.85 },
  node: { l0: 'stack', lanes: 'dash' },
  edges: NO_EDGES,
  ramp: RAMP_PAINTED,
  finish: { contactShadow: 0.6, shadowBlur: 2, bevel: 0.05, statusAs: 'fill' },
};

/** A2. FROSTED GLASS & SANDSTONE — real frosted-glass decks that transmit
 *  light, sandstone tiles, warm graphite floor. */
const FROSTED_GLASS: DesignRecipe = {
  id: 'b3-2',
  name: 'frosted glass & sandstone',
  note: 'A · light passes through frosted glass decks, sandstone tiles',
  ground: { bg: '#15161a', fog: true, floor: 'plane', grid: '#1b1c20', section: '#1b1c20', mirror: 0 },
  light: { ambient: 0.5, key: 1.3, keyColor: '#fff3e2', keyFrom: [10, 18, 12], fill: 0.5, fillColor: '#a9bccb', env: 'soft', tone: 'aces', exposure: 1.05 },
  surface: { roughness: 0.92, metalness: 0, clearcoat: 0, clearcoatRoughness: 1, emissive: 0, emissiveMuted: 0, slab: 1, halo: 0, mode: 'physical', opaqueTiles: true, bodyColor: '#ffffff', attentionGlow: 0 },
  deck: { style: 'solid', color: '#cdbfa8', opacity: 1, transmission: 0.92, roughness: 0.5, metalness: 0 },
  node: { l0: 'stack', lanes: 'dash' },
  edges: NO_EDGES,
  ramp: RAMP_STONE,
  finish: { contactShadow: 0.55, shadowBlur: 2.4, bevel: 0.06, statusAs: 'fill' },
};

/** A3. CONCRETE & BRASS — matte concrete decks and plinths, brushed-brass
 *  tiles, a low warm key throwing long shadows. */
const CONCRETE: DesignRecipe = {
  id: 'b3-3',
  name: 'concrete & brass',
  note: 'A · matte concrete decks, brushed-brass tiles, low warm key',
  ground: { bg: '#1a1816', fog: true, floor: 'plane', grid: '#232019', section: '#232019', mirror: 0 },
  light: { ambient: 0.3, key: 1.8, keyColor: '#ffd9ae', keyFrom: [-14, 9, 16], fill: 0.45, fillColor: '#8fa3b6', env: 'soft', tone: 'aces', exposure: 1.1 },
  surface: { roughness: 0.45, metalness: 0.7, clearcoat: 0.1, clearcoatRoughness: 0.6, emissive: 0, emissiveMuted: 0, slab: 1, halo: 0, mode: 'physical', opaqueTiles: true, bodyColor: '#ffffff', attentionGlow: 0 },
  deck: { style: 'solid', color: '#55524d', opacity: 1, transmission: 0, roughness: 0.96, metalness: 0 },
  node: { l0: 'stack', lanes: 'dash' },
  edges: NO_EDGES,
  ramp: RAMP_BRASS,
  finish: { contactShadow: 0.65, shadowBlur: 1.8, bevel: 0.03, statusAs: 'fill' },
};

// ── Group B: the shipped palette, a different project at L0 ─────────────────
//
// Held: everything the Strata tab ships — ground, light, frost, ramp, edges.
// Varied: the L0 body and the lanes. Dimensions are not in sight until the
// node opens into the stack on the way to L1.

const asStrata = (id: string, name: string, note: string, node: DesignRecipe['node']): DesignRecipe => ({
  ...STRATA_RECIPE,
  id,
  name,
  note,
  node,
  // Grounded, so the closed bodies sit rather than float — the one finish
  // change the whole group carries.
  finish: { ...STRATA_RECIPE.finish, contactShadow: 0.45, shadowBlur: 2.2 },
});

/** B1. MONOLITH — a project is one closed block with its name on top; ribbon
 *  lanes on the floor; the block splits into the four decks on L1. */
const MONOLITH = asStrata('b3-4', 'monolith', 'B · one closed block per project, ribbon lanes; splits into decks on L1', { l0: 'slab', lanes: 'ribbon' });

/** B2. MEDALLION — a project is a flat disc with a state ring; lanes arc
 *  between discs; the stack rises out of the disc on L1. */
const MEDALLION = asStrata('b3-5', 'medallion', 'B · flat disc with a state ring, arcing lanes; the stack rises out of it on L1', { l0: 'disc', lanes: 'arc' });

/** B3. CARD — a project is an upright plate with its name and state bar;
 *  ribbon lanes; the card lays down and the decks explode on L1. */
const CARD = asStrata('b3-6', 'card', 'B · upright name card per project, ribbon lanes; lays down into the stack on L1', { l0: 'card', lanes: 'ribbon' });

export const BOARD_3: Board = {
  id: 'b3',
  frames: [0, 1],
  recipes: [ANODISED, FROSTED_GLASS, CONCRETE, MONOLITH, MEDALLION, CARD],
};

/** The board the app renders. Swap this when breeding the next round. */
export const CURRENT_BOARD: Board = BOARD_3;

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
    glass: r.deck.color,
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
      slab: r.deck.opacity,
      halo: r.surface.halo,
    },
  };
}
