import { describe, expect, it } from 'vitest';

import { DIM_ORDER } from '../lib/dimRegistry';
import { MOCK_WORLD } from '../three/mockWorld';
import { STRATA } from '../three/palettes';
import { BOARD_2, CURRENT_BOARD, recipeToPalette, STRATA_RECIPE, type DesignRecipe } from '../three/board/recipes';
import { BOARD_L1_PROJECT, frameFocus, staticNav } from '../three/board/staticNav';

const STATUSES = ['absent', 'solid', 'partial', 'risk', 'alert', 'unknown'] as const;
const STATES = ['healthy', 'building', 'warning', 'critical'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

/** Perceived lightness of a hex colour, 0..1 — enough to tell a cream table from a black one. */
const lightness = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** What makes a recipe a different ART DIRECTION rather than a retune: the
 *  switches, not the numbers. */
const direction = (r: DesignRecipe) =>
  `${r.surface.mode}|${r.deck.style}|${r.ground.floor}|${r.finish.statusAs}|${lightness(r.ground.bg) > 0.5 ? 'light' : 'dark'}|${r.edges.tint}`;

describe('design recipes', () => {
  it('every recipe carries a complete colour ramp of real hex colours and sane numbers', () => {
    for (const r of [STRATA_RECIPE, ...CURRENT_BOARD.recipes]) {
      for (const s of STATUSES) expect(r.ramp.status[s], `${r.id} status ${s}`).toMatch(HEX);
      for (const s of STATES) expect(r.ramp.state[s], `${r.id} state ${s}`).toMatch(HEX);
      expect(r.ground.bg).toMatch(HEX);
      expect(r.deck.color).toMatch(HEX);
      expect(r.surface.bodyColor).toMatch(HEX);
      expect(r.surface.roughness).toBeGreaterThanOrEqual(0);
      expect(r.surface.roughness).toBeLessThanOrEqual(1);
      expect(r.deck.opacity).toBeGreaterThan(0);
      expect(r.deck.opacity).toBeLessThanOrEqual(1);
      expect(r.finish.contactShadow).toBeGreaterThanOrEqual(0);
      expect(r.finish.contactShadow).toBeLessThanOrEqual(1);
      // unlit modes must not depend on lights that are off
      if (r.surface.mode !== 'physical') expect(r.light.ambient).toBeGreaterThan(0);
    }
  });

  it('the anchor recipe reproduces the shipped Strata palette exactly', () => {
    const p = recipeToPalette(STRATA_RECIPE);
    expect(p.bg).toBe(STRATA.bg);
    expect(p.status).toEqual(STRATA.status);
    expect(p.state).toEqual(STRATA.state);
    expect(p.frost).toEqual(STRATA.frost);
    expect(p.grid).toBe(STRATA.grid);
    expect(p.glass).toBe(STRATA.glass);
    expect(STRATA_RECIPE.surface.mode).toBe('physical');
    expect(STRATA_RECIPE.deck.style).toBe('slab');
  });

  it('recipeToPalette keeps the palette shape the scene reads', () => {
    for (const r of CURRENT_BOARD.recipes) {
      const p = recipeToPalette(r);
      expect(p.id).toBe('strata');
      expect(p.fontDisplay).toBe(STRATA.fontDisplay);
      expect(p.fog).toBe(r.ground.fog ? r.ground.bg : null);
      expect(p.frost.slab).toBe(r.deck.opacity);
      expect(Object.keys(p.frost).sort()).toEqual(['clearcoat', 'clearcoatRoughness', 'emissive', 'emissiveMuted', 'halo', 'metalness', 'roughness', 'slab']);
    }
  });
});

describe('board 2 — six art directions at L1', () => {
  it('is the current board, judged at L1 only, with six uniquely-named recipes', () => {
    expect(CURRENT_BOARD).toBe(BOARD_2);
    expect(BOARD_2.frames).toEqual([1]);
    expect(BOARD_2.recipes).toHaveLength(6);
    expect(new Set(BOARD_2.recipes.map((r) => r.id)).size).toBe(6);
    expect(new Set(BOARD_2.recipes.map((r) => r.name)).size).toBe(6);
    for (const r of BOARD_2.recipes) expect(r.note.length).toBeGreaterThan(10);
  });

  it('every recipe is a DIFFERENT art direction, not a retune of the same one', () => {
    // The operator's complaint about board 1: "the artstyle, node colouring
    // and surface is still the same, only reshaped, slightly different tone."
    // A direction is the set of switches; six recipes must give six sets, and
    // none may equal the shipped look's.
    const dirs = BOARD_2.recipes.map(direction);
    expect(new Set(dirs).size).toBe(6);
    expect(dirs).not.toContain(direction(STRATA_RECIPE));
  });

  it('spans the switches that change a picture: light AND dark grounds, lit AND unlit surfaces, a mirror, a cap, a frame', () => {
    const rs = BOARD_2.recipes;
    const light = rs.filter((r) => lightness(r.ground.bg) > 0.5).length;
    expect(light).toBeGreaterThanOrEqual(2);
    expect(rs.length - light).toBeGreaterThanOrEqual(2);
    expect(new Set(rs.map((r) => r.surface.mode))).toEqual(new Set(['physical', 'flat', 'wire']));
    expect(rs.some((r) => r.ground.floor === 'mirror')).toBe(true);
    expect(rs.some((r) => r.finish.statusAs === 'cap')).toBe(true);
    expect(rs.some((r) => r.deck.style === 'frame')).toBe(true);
    expect(rs.some((r) => r.edges.tint === 'off')).toBe(true);
    expect(rs.some((r) => r.surface.attentionGlow > 0)).toBe(true);
  });

  it('a light-ground recipe has no additive halos — they wash out on a light background', () => {
    for (const r of BOARD_2.recipes) {
      if (lightness(r.ground.bg) > 0.5) expect(r.surface.halo, r.id).toBe(0);
    }
  });
});

describe('board frames', () => {
  it('L0 is the portfolio and L1 opens the project with the full status range', () => {
    expect(frameFocus(0)).toEqual({ level: 0, project: null, dim: null });
    expect(frameFocus(1).level).toBe(1);
    expect(frameFocus(1).project).toBe(BOARD_L1_PROJECT);
    const p = MOCK_WORLD.projects.find((x) => x.slug === BOARD_L1_PROJECT)!;
    const statuses = new Set(p.dims.map((d) => d.status));
    expect(statuses).toContain('alert');
    expect(statuses).toContain('risk');
    expect(statuses).toContain('absent');
    expect(statuses).toContain('solid');
  });

  it('staticNav is frozen: the focus sticks and nothing dispatches', () => {
    const nav = staticNav(frameFocus(1));
    expect(nav.state.focus).toEqual({ level: 1, project: BOARD_L1_PROJECT, dim: null });
    expect(nav.state.flight).toBe(0);
    nav.openProject('brainiac');
    nav.openDim('brainiac', DIM_ORDER[0]!);
    nav.up();
    nav.home();
    expect(nav.state.focus).toEqual({ level: 1, project: BOARD_L1_PROJECT, dim: null });
  });
});
