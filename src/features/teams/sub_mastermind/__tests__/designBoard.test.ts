import { describe, expect, it } from 'vitest';

import { DIM_ORDER } from '../lib/dimRegistry';
import { MOCK_WORLD } from '../three/mockWorld';
import { STRATA } from '../three/palettes';
import { BOARD_3, CURRENT_BOARD, recipeToPalette, STRATA_RECIPE, type DesignRecipe } from '../three/board/recipes';
import { BOARD_L1_PROJECT, frameFocus, staticNav } from '../three/board/staticNav';

const STATUSES = ['absent', 'solid', 'partial', 'risk', 'alert', 'unknown'] as const;
const STATES = ['healthy', 'building', 'warning', 'critical'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

/** Hue (degrees), saturation and lightness of a hex colour. */
function hsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return { h: h * 60, s, l };
}
const hueGap = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Which of the three real materials a deck is — the dominant physical property names it. */
function deckMaterial(r: DesignRecipe): 'metal' | 'glass' | 'matte' {
  if (r.deck.metalness > 0.5) return 'metal';
  if (r.deck.transmission > 0.5) return 'glass';
  return 'matte';
}

const GROUP_A = BOARD_3.recipes;

describe('design recipes', () => {
  it('every recipe carries a complete colour ramp of real hex colours and sane numbers', () => {
    for (const r of [STRATA_RECIPE, ...CURRENT_BOARD.recipes]) {
      for (const s of STATUSES) expect(r.ramp.status[s], `${r.id} status ${s}`).toMatch(HEX);
      for (const s of STATES) expect(r.ramp.state[s], `${r.id} state ${s}`).toMatch(HEX);
      expect(r.ground.bg).toMatch(HEX);
      expect(r.deck.color).toMatch(HEX);
      expect(r.surface.roughness).toBeGreaterThanOrEqual(0);
      expect(r.surface.roughness).toBeLessThanOrEqual(1);
      expect(r.deck.transmission).toBeGreaterThanOrEqual(0);
      expect(r.deck.transmission).toBeLessThanOrEqual(1);
      expect(r.ground.mirror).toBeGreaterThanOrEqual(0);
      expect(r.ground.mirror).toBeLessThanOrEqual(1);
      expect(r.finish.contactShadow).toBeGreaterThanOrEqual(0);
      expect(r.finish.contactShadow).toBeLessThanOrEqual(1);
    }
  });

  it('the anchor recipe reproduces the shipped Strata palette exactly and the shipped structure', () => {
    const p = recipeToPalette(STRATA_RECIPE);
    expect(p.bg).toBe(STRATA.bg);
    expect(p.status).toEqual(STRATA.status);
    expect(p.state).toEqual(STRATA.state);
    expect(p.frost).toEqual(STRATA.frost);
    expect(p.glass).toBe(STRATA.glass);
    expect(STRATA_RECIPE.node).toEqual({ l0: 'stack', lanes: 'dash' });
    expect(STRATA_RECIPE.deck.transmission).toBe(0);
  });
});

describe('board 3 — the two realistic materials in Strata hues the operator kept', () => {
  it('is the current board, judged at both layers, two unique recipes', () => {
    expect(CURRENT_BOARD).toBe(BOARD_3);
    expect(BOARD_3.frames).toEqual([0, 1]);
    expect(BOARD_3.recipes).toHaveLength(2);
    expect(new Set(BOARD_3.recipes.map((r) => r.id)).size).toBe(2);
    for (const r of GROUP_A) expect(r.note.startsWith('A ·'), r.id).toBe(true);
  });

  it('group A keeps the shipped STRUCTURE and changes only the material', () => {
    for (const r of GROUP_A) {
      expect(r.node, r.id).toEqual({ l0: 'stack', lanes: 'dash' });
      expect(r.surface.mode, r.id).toBe('physical');
      // realistic objects have no outlines
      expect(r.edges.tint, r.id).toBe('off');
      // and sit on the floor
      expect(r.finish.contactShadow, r.id).toBeGreaterThan(0);
    }
    // two genuinely different materials, not one retuned
    const decks = GROUP_A.map(deckMaterial);
    expect(new Set(decks)).toEqual(new Set(['metal', 'glass']));
  });

  it("group A's status hues stay within Strata's, toned DOWN — not pastel, not neon", () => {
    // The operator: "tone down colour set, but with palette aligned with
    // baseline Strata (if there is blue, choose tones of blue)". So every
    // status colour must keep the shipped hue and be no more saturated.
    for (const r of GROUP_A) {
      for (const s of ['solid', 'partial', 'risk', 'alert'] as const) {
        const base = hsl(STRATA.status[s]);
        const mine = hsl(r.ramp.status[s]);
        expect(hueGap(base.h, mine.h), `${r.id} ${s} hue drifted`).toBeLessThanOrEqual(25);
        expect(mine.s, `${r.id} ${s} more saturated than shipped`).toBeLessThanOrEqual(base.s + 0.02);
        expect(mine.l, `${r.id} ${s} lighter than shipped (pastel)`).toBeLessThanOrEqual(base.l);
      }
      expect(r.ramp.primary).toBe(STRATA.primary);
      expect(r.ramp.accent).toBe(STRATA.accent);
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
    for (const s of ['alert', 'risk', 'absent', 'solid']) expect(statuses).toContain(s);
  });

  it('staticNav is frozen except for the flight counter the layer switch drives', () => {
    const nav = staticNav(frameFocus(1));
    expect(nav.state.focus).toEqual({ level: 1, project: BOARD_L1_PROJECT, dim: null });
    expect(nav.state.flight).toBe(0);
    expect(staticNav(frameFocus(0), 3).state.flight).toBe(3);
    nav.openProject('brainiac');
    nav.openDim('brainiac', DIM_ORDER[0]!);
    nav.up();
    nav.home();
    expect(nav.state.focus).toEqual({ level: 1, project: BOARD_L1_PROJECT, dim: null });
  });
});

/** Type-level guard that the recipe shape stays complete for the scene. */
const _shape: DesignRecipe = STRATA_RECIPE;
void _shape;
