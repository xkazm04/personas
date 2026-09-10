// Design recipes for the Strata board — the vocabulary the operator points at.
//
// A recipe is every knob that decides how the Strata world LOOKS, in one plain
// object, so a variant is a line of data rather than a fork of the scene. The
// board renders each recipe into the frames the board asks for and lays them
// out as a contact sheet; the operator names cells, and the next board is
// bred from the winners.
//
// ROUND 2 OF THE BOARD, and the lesson from round 1: varying NUMBERS inside
// one rendering mode — roughness here, a ground tone there — produced ten
// cells that were the same picture in a slightly different key. The operator
// said so. So a recipe now chooses a rendering MODE (physical / flat / wire),
// a DECK style (slab / solid / frame / none), a floor (grid / plane / mirror),
// and where status colour is allowed to live (the whole tile, or only a cap on
// top of a neutral body). Those are the switches that change the art
// direction; the numbers only tune it.
//
// Names and notes are developer vocabulary rendered in mono as identifiers,
// like project slugs and tool names; they are not product copy and change
// every round, so they are deliberately not routed through i18n.
import type { DimStatus, IslandState } from '../../lib/types';
import { STRATA, type FrostProfile, type WorldPalette } from '../palettes';

export type SurfaceMode = 'physical' | 'flat' | 'wire';
export type DeckStyle = 'slab' | 'solid' | 'frame' | 'none';
export type FloorKind = 'grid' | 'plane' | 'mirror' | 'none';
export type EnvKind = 'none' | 'soft' | 'studio';
export type ToneMode = 'aces' | 'neutral' | 'none';
/** Which colour an outline takes: the cell's own status colour, one neutral
 *  ink, the world's primary hue, or no outlines at all. */
export type EdgeTint = 'own' | 'neutral' | 'primary' | 'off';
/** Where a tile carries its status colour: the whole body, or a thin cap on a
 *  neutral body — which is what lets a white or black world stay white or
 *  black and still read status. */
export type StatusPlacement = 'fill' | 'cap';

export interface DesignRecipe {
  /** Short and stable — what the operator points at ("b2-4"). */
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
  };
  light: {
    ambient: number;
    key: number;
    keyColor: string;
    /** Key light position — a low angle is a different picture from a high one. */
    keyFrom: [number, number, number];
    fill: number;
    fillColor: string;
    env: EnvKind;
    tone: ToneMode;
    exposure: number;
  };
  surface: FrostProfile & {
    mode: SurfaceMode;
    /** Tiles fully opaque or translucent (physical mode only). */
    opaqueTiles: boolean;
    /** Body colour when status sits on a cap instead of the whole tile. */
    bodyColor: string;
    /** Emissive boost for risk/alert tiles — "only trouble glows". */
    attentionGlow: number;
  };
  deck: {
    style: DeckStyle;
    color: string;
    /** Opacity of a slab / solid deck. */
    opacity: number;
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
    /** Contact-shadow opacity; 0 = no shadows at all. */
    contactShadow: number;
    shadowBlur: number;
    /** Corner radius on tiles; 0 = sharp boxes. */
    bevel: number;
    statusAs: StatusPlacement;
  };
}

/** A board: which recipes, judged in which frames (0 = portfolio, 1 = one
 *  project exploded). Round 2 judges L1 only — that is where the art
 *  direction lives; the portfolio inherits it. */
export interface Board {
  id: string;
  frames: Array<0 | 1>;
  recipes: DesignRecipe[];
}

// ── The shipped look, as a recipe ───────────────────────────────────────────

/** Exactly what the Strata tab ships today. Changing this changes the product
 *  tab; the board is where a change gets CHOSEN before it lands here. */
export const STRATA_RECIPE: DesignRecipe = {
  id: 'current',
  name: 'current',
  note: 'the shipped Strata look',
  ground: { bg: STRATA.bg, fog: true, floor: 'grid', grid: STRATA.grid, section: STRATA.gridSection },
  light: { ambient: 0.55, key: 1.15, keyColor: '#fff0da', keyFrom: [14, 22, 10], fill: 0.4, fillColor: '#9fb6c4', env: 'soft', tone: 'aces', exposure: 1 },
  surface: { ...STRATA.frost, mode: 'physical', opaqueTiles: false, bodyColor: '#ffffff', attentionGlow: 0 },
  deck: { style: 'slab', color: STRATA.glass, opacity: STRATA.frost.slab },
  edges: { tint: 'own', weight: 0.6, neutral: '#6b6f78' },
  ramp: { primary: STRATA.primary, accent: STRATA.accent, structure: STRATA.structure, status: STRATA.status, state: STRATA.state },
  finish: { contactShadow: 0, shadowBlur: 2, bevel: 0, statusAs: 'fill' },
};

// ── Board 2: six art directions, judged at L1 ───────────────────────────────

const MATTE: FrostProfile = { roughness: 0.95, metalness: 0, clearcoat: 0, clearcoatRoughness: 1, emissive: 0, emissiveMuted: 0, slab: 1, halo: 0 };

/** 1. IVORY MAQUETTE — an architect's model on a cream table. Light ground,
 *  matte clay pastels, no outlines at all, the shadow does the drawing. */
const IVORY: DesignRecipe = {
  id: 'b2-1',
  name: 'ivory maquette',
  note: 'architect model on a cream table · light ground, matte clay, no outlines',
  ground: { bg: '#ece6da', fog: true, floor: 'plane', grid: '#e1dacc', section: '#d6cebe' },
  light: { ambient: 0.75, key: 1.6, keyColor: '#fff6e8', keyFrom: [10, 18, 8], fill: 0.5, fillColor: '#dbe4ec', env: 'soft', tone: 'neutral', exposure: 1.05 },
  surface: { ...MATTE, mode: 'physical', opaqueTiles: true, bodyColor: '#f6f1e8', attentionGlow: 0 },
  deck: { style: 'solid', color: '#f7f2ea', opacity: 0.96 },
  edges: { tint: 'off', weight: 0, neutral: '#000000' },
  ramp: {
    primary: '#8a7a64', accent: '#c47a52', structure: '#e3dccf',
    status: { solid: '#8fb79a', partial: '#8ea7c7', risk: '#dcaa5e', alert: '#d4776d', unknown: '#b9b1a3', absent: '#d9d2c5' },
    state: { healthy: '#8fb79a', building: '#8ea7c7', warning: '#dcaa5e', critical: '#d4776d' },
  },
  finish: { contactShadow: 0.5, shadowBlur: 2.6, bevel: 0.07, statusAs: 'fill' },
};

/** 2. BLUEPRINT — one ink on drafting blue. Everything is line: wire tiles,
 *  frame decks, a drafting grid. Status is the ONLY thing allowed a hue. */
const BLUEPRINT: DesignRecipe = {
  id: 'b2-2',
  name: 'blueprint',
  note: 'drafting-table wireframe · one ink, status is the only hue',
  ground: { bg: '#0f2f55', fog: false, floor: 'grid', grid: '#1b4477', section: '#2a5c99' },
  light: { ambient: 1, key: 0, keyColor: '#ffffff', keyFrom: [0, 10, 0], fill: 0, fillColor: '#ffffff', env: 'none', tone: 'none', exposure: 1 },
  surface: { ...MATTE, mode: 'wire', opaqueTiles: false, bodyColor: '#dff1ff', attentionGlow: 0 },
  deck: { style: 'frame', color: '#dff1ff', opacity: 1 },
  edges: { tint: 'own', weight: 1.1, neutral: '#dff1ff' },
  ramp: {
    primary: '#dff1ff', accent: '#ffd27a', structure: '#0f2f55',
    status: { solid: '#dff1ff', partial: '#8fc3ee', risk: '#ffd27a', alert: '#ff8f7a', unknown: '#7f9fbd', absent: '#3d6491' },
    state: { healthy: '#dff1ff', building: '#8fc3ee', warning: '#ffd27a', critical: '#ff8f7a' },
  },
  finish: { contactShadow: 0, shadowBlur: 0, bevel: 0, statusAs: 'fill' },
};

/** 3. OBSIDIAN & BRASS — a black mirror floor, smoked-glass decks, metal
 *  tiles. Status in metals (brass / steel / copper / oxblood), not in hues. */
const OBSIDIAN: DesignRecipe = {
  id: 'b2-3',
  name: 'obsidian & brass',
  note: 'black mirror floor, smoked glass decks, status in metals',
  ground: { bg: '#050506', fog: true, floor: 'mirror', grid: '#0b0b0d', section: '#0b0b0d' },
  light: { ambient: 0.25, key: 2.2, keyColor: '#ffd9a8', keyFrom: [-12, 8, 14], fill: 0.5, fillColor: '#6f86a8', env: 'studio', tone: 'aces', exposure: 1.1 },
  surface: { roughness: 0.28, metalness: 0.9, clearcoat: 0.6, clearcoatRoughness: 0.3, emissive: 0, emissiveMuted: 0, slab: 0.5, halo: 0.06, mode: 'physical', opaqueTiles: true, bodyColor: '#c9a353', attentionGlow: 0 },
  deck: { style: 'slab', color: '#141416', opacity: 0.55 },
  edges: { tint: 'off', weight: 0, neutral: '#000000' },
  ramp: {
    primary: '#c9a353', accent: '#e8c98a', structure: '#0d0d0f',
    status: { solid: '#c9a353', partial: '#9aa6b2', risk: '#c4784a', alert: '#8c2f2f', unknown: '#5c5750', absent: '#2a2a2d' },
    state: { healthy: '#c9a353', building: '#9aa6b2', warning: '#c4784a', critical: '#8c2f2f' },
  },
  finish: { contactShadow: 0, shadowBlur: 0, bevel: 0.03, statusAs: 'fill' },
};

/** 4. FLAT INFOGRAPHIC — unlit vector illustration. Saturated pastel fills,
 *  one dark ink outline, no shadow, no fog, no lighting at all. */
const FLAT: DesignRecipe = {
  id: 'b2-4',
  name: 'flat infographic',
  note: 'unlit vector illustration · pastel fills, one ink outline, no light',
  ground: { bg: '#f7f3ea', fog: false, floor: 'plane', grid: '#ede7da', section: '#ede7da' },
  light: { ambient: 1, key: 0, keyColor: '#ffffff', keyFrom: [0, 10, 0], fill: 0, fillColor: '#ffffff', env: 'none', tone: 'none', exposure: 1 },
  surface: { ...MATTE, mode: 'flat', opaqueTiles: true, bodyColor: '#ffffff', attentionGlow: 0 },
  deck: { style: 'solid', color: '#ffffff', opacity: 1 },
  edges: { tint: 'neutral', weight: 1.4, neutral: '#23201c' },
  ramp: {
    primary: '#23201c', accent: '#f26b5b', structure: '#e9e3d6',
    status: { solid: '#63c993', partial: '#6a95ec', risk: '#f5b53a', alert: '#f06060', unknown: '#b9b4aa', absent: '#e2ddd2' },
    state: { healthy: '#63c993', building: '#6a95ec', warning: '#f5b53a', critical: '#f06060' },
  },
  finish: { contactShadow: 0, shadowBlur: 0, bevel: 0, statusAs: 'fill' },
};

/** 5. PORCELAIN — a product render. White ceramic tiles and decks on pale
 *  grey; status lives ONLY on a coloured cap, so the world stays white. */
const PORCELAIN: DesignRecipe = {
  id: 'b2-5',
  name: 'porcelain',
  note: 'white ceramic product render · status only as a cap on a white body',
  ground: { bg: '#dfe3e8', fog: true, floor: 'plane', grid: '#d3d8de', section: '#c8ced5' },
  light: { ambient: 0.7, key: 1.4, keyColor: '#ffffff', keyFrom: [8, 20, 10], fill: 0.6, fillColor: '#dfe8f2', env: 'studio', tone: 'neutral', exposure: 1 },
  surface: { roughness: 0.32, metalness: 0.02, clearcoat: 0.9, clearcoatRoughness: 0.2, emissive: 0, emissiveMuted: 0, slab: 0.92, halo: 0, mode: 'physical', opaqueTiles: true, bodyColor: '#f7f9fb', attentionGlow: 0 },
  deck: { style: 'solid', color: '#f3f5f8', opacity: 0.92 },
  edges: { tint: 'off', weight: 0, neutral: '#000000' },
  ramp: {
    primary: '#6b7480', accent: '#3a7bd5', structure: '#e4e8ed',
    status: { solid: '#3aa876', partial: '#4a7fd6', risk: '#e0a12f', alert: '#d94f4f', unknown: '#9aa2ab', absent: '#c5ccd4' },
    state: { healthy: '#3aa876', building: '#4a7fd6', warning: '#e0a12f', critical: '#d94f4f' },
  },
  finish: { contactShadow: 0.45, shadowBlur: 2.2, bevel: 0.08, statusAs: 'cap' },
};

/** 6. EMBER — warm black, everything matte and quiet, and ONLY trouble glows.
 *  Colour budget spent entirely on risk and alert. */
const EMBER: DesignRecipe = {
  id: 'b2-6',
  name: 'ember',
  note: 'warm black, matte and quiet · only risk and alert glow',
  ground: { bg: '#110c0a', fog: true, floor: 'plane', grid: '#17110e', section: '#17110e' },
  light: { ambient: 0.3, key: 1.1, keyColor: '#ffb26b', keyFrom: [-6, 4, 16], fill: 0.35, fillColor: '#5a6f8a', env: 'none', tone: 'aces', exposure: 0.9 },
  surface: { ...MATTE, roughness: 0.9, emissive: 0, emissiveMuted: 0, slab: 0.2, halo: 0.25, mode: 'physical', opaqueTiles: true, bodyColor: '#3a3532', attentionGlow: 1.6 },
  deck: { style: 'frame', color: '#d9743a', opacity: 1 },
  edges: { tint: 'off', weight: 0, neutral: '#000000' },
  ramp: {
    primary: '#d9743a', accent: '#ffb26b', structure: '#16110e',
    status: { solid: '#4a5a52', partial: '#3f4a5a', risk: '#ff9a3c', alert: '#ff4d3a', unknown: '#3e3a36', absent: '#26221f' },
    state: { healthy: '#4a5a52', building: '#3f4a5a', warning: '#ff9a3c', critical: '#ff4d3a' },
  },
  finish: { contactShadow: 0.6, shadowBlur: 2.4, bevel: 0.04, statusAs: 'fill' },
};

export const BOARD_2: Board = {
  id: 'b2',
  frames: [1],
  recipes: [IVORY, BLUEPRINT, OBSIDIAN, FLAT, PORCELAIN, EMBER],
};

/** The board the app renders. Swap this when breeding the next round. */
export const CURRENT_BOARD: Board = BOARD_2;

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
