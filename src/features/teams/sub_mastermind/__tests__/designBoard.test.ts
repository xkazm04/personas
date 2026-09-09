import { describe, expect, it } from 'vitest';

import { DIM_ORDER } from '../lib/dimRegistry';
import { STRATA } from '../three/palettes';
import { BOARD_1, boardAxes, CURRENT_BOARD, recipeToPalette, STRATA_RECIPE } from '../three/board/recipes';
import { BOARD_FRAMES, staticNav } from '../three/board/staticNav';

const STATUSES = ['absent', 'solid', 'partial', 'risk', 'alert', 'unknown'] as const;
const STATES = ['healthy', 'building', 'warning', 'critical'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

describe('design recipes', () => {
  it('the board has unique ids, one anchor, and every cell names every axis', () => {
    const ids = CURRENT_BOARD.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CURRENT_BOARD[0]).toBe(STRATA_RECIPE);
    const axes = boardAxes(CURRENT_BOARD);
    expect(axes.length).toBeGreaterThan(0);
    for (const r of CURRENT_BOARD) for (const a of axes) expect(r.axes[a], `${r.id} lacks axis ${a}`).toBeTruthy();
  });

  it('board 1 varies exactly two axes and holds the rest', () => {
    expect(boardAxes(BOARD_1)).toEqual(['material', 'ground']);
    const cells = BOARD_1.filter((r) => r !== STRATA_RECIPE);
    expect(cells).toHaveLength(9);
    // Held: ramp, light, edges, finish are the SAME object or equal across cells.
    for (const r of cells) {
      expect(r.ramp).toEqual(cells[0]!.ramp);
      expect(r.light).toEqual(cells[0]!.light);
      expect(r.edges).toEqual(cells[0]!.edges);
      expect(r.finish).toEqual(cells[0]!.finish);
    }
    // Varied: three materials × three grounds, each pairing once.
    const pairs = new Set(cells.map((r) => `${r.axes.material}|${r.axes.ground}`));
    expect(pairs.size).toBe(9);
    expect(new Set(cells.map((r) => r.axes.material)).size).toBe(3);
    expect(new Set(cells.map((r) => r.axes.ground)).size).toBe(3);
  });

  it('every recipe carries a complete colour ramp of real hex colours', () => {
    for (const r of CURRENT_BOARD) {
      for (const s of STATUSES) expect(r.ramp.status[s], `${r.id} status ${s}`).toMatch(HEX);
      for (const s of STATES) expect(r.ramp.state[s], `${r.id} state ${s}`).toMatch(HEX);
      expect(r.ground.bg).toMatch(HEX);
      expect(r.surface.roughness).toBeGreaterThanOrEqual(0);
      expect(r.surface.roughness).toBeLessThanOrEqual(1);
      expect(r.finish.contactShadow).toBeGreaterThanOrEqual(0);
      expect(r.finish.contactShadow).toBeLessThanOrEqual(1);
    }
  });

  it('the anchor recipe reproduces the shipped Strata palette exactly', () => {
    const p = recipeToPalette(STRATA_RECIPE);
    expect(p.bg).toBe(STRATA.bg);
    expect(p.status).toEqual(STRATA.status);
    expect(p.state).toEqual(STRATA.state);
    expect(p.frost).toEqual(STRATA.frost);
    expect(p.grid).toBe(STRATA.grid);
    // and it is the WITHOUT for the two hypotheses the board tests
    expect(STRATA_RECIPE.finish.contactShadow).toBe(0);
    expect(STRATA_RECIPE.light.tone).toBe('aces');
  });

  it('recipeToPalette keeps the palette shape the scene reads', () => {
    for (const r of CURRENT_BOARD) {
      const p = recipeToPalette(r);
      expect(p.id).toBe('strata');
      expect(p.fontDisplay).toBe(STRATA.fontDisplay);
      expect(p.fog).toBe(r.ground.fog ? r.ground.bg : null);
      expect(Object.keys(p.frost).sort()).toEqual(['clearcoat', 'clearcoatRoughness', 'emissive', 'emissiveMuted', 'halo', 'metalness', 'roughness', 'slab']);
    }
  });
});

describe('board frames', () => {
  it('judges every recipe at L0 and at L1 on a project that exists', () => {
    expect(BOARD_FRAMES.map((f) => f.level)).toEqual([0, 1]);
    expect(BOARD_FRAMES[0]!.focus).toEqual({ level: 0, project: null, dim: null });
    expect(BOARD_FRAMES[1]!.focus.level).toBe(1);
    expect(BOARD_FRAMES[1]!.focus.project).toBe('personas');
  });

  it('staticNav is frozen: the focus sticks and nothing dispatches', () => {
    const nav = staticNav({ level: 1, project: 'personas', dim: null });
    expect(nav.state.focus).toEqual({ level: 1, project: 'personas', dim: null });
    expect(nav.state.flight).toBe(0);
    nav.openProject('brainiac');
    nav.openDim('brainiac', DIM_ORDER[0]!);
    nav.up();
    nav.home();
    expect(nav.state.focus).toEqual({ level: 1, project: 'personas', dim: null });
  });
});
