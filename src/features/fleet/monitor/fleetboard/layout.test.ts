// layout - the Board's geometry at the Monitor's real body sizes.
//
// Two fleet shapes, two windows. The REAL fleet is the operator's database as
// scouted on 2026-10-05: 30 personas, one team of 12, one of 2, eleven
// singletons, five teamless, and six workspace groups nobody is filed in. The
// SIMULATED fleet is the load harness's 20 projects x 5. The field sizes are
// the Board body at a 1280x800 window (1270x620 minus the strips, the rail and
// the Monitor's padding) and at 1920x1080 (1910x900, likewise).

import { describe, expect, it } from 'vitest';
import { GEOMETRY, fitTiles, layoutField, squarify, tierOf, type BayInput, type BayLayout, type Rect } from './layout';

const REAL: BayInput[] = [
  { id: 'big', count: 12 }, { id: 'pair', count: 2 },
  ...Array.from({ length: 11 }, (_, i) => ({ id: `solo-${i}`, count: 1 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `ws-${i}`, count: 0 })),
  { id: 'teamless', count: 5 },
];
const SIM: BayInput[] = Array.from({ length: 20 }, (_, i) => ({ id: `proj-${i}`, count: 5 }));

const SIZES: Array<[string, number, number]> = [
  ['1280x800', 1014, 528],
  ['1920x1080', 1594, 808],
];

const area = (r: Rect) => r.w * r.h;
const inside = (a: Rect, b: Rect, slack = 0.5) =>
  a.x >= b.x - slack && a.y >= b.y - slack && a.x + a.w <= b.x + b.w + slack && a.y + a.h <= b.y + b.h + slack;
const overlap = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;

function body(bay: BayLayout): Rect {
  const { head, pad } = GEOMETRY;
  return { x: bay.rect.x + pad, y: bay.rect.y + head, w: bay.rect.w - 2 * pad, h: bay.rect.h - head - pad };
}

function checkField(bays: BayLayout[], inputs: BayInput[], w: number, h: number) {
  const field: Rect = { x: 0, y: 0, w, h };
  const drawn = inputs.filter((b) => b.count > 0);
  expect(bays.map((b) => b.id)).toEqual(drawn.map((b) => b.id));
  for (const [i, bay] of bays.entries()) {
    expect(inside(bay.rect, field)).toBe(true);
    for (const other of bays.slice(i + 1)) expect(overlap(bay.rect, other.rect)).toBe(false);
    expect(bay.tiles).toHaveLength(drawn[i]!.count);
    for (const [k, tile] of bay.tiles.entries()) {
      expect(inside(tile, body(bay))).toBe(true);
      for (const t2 of bay.tiles.slice(k + 1)) expect(overlap(tile, t2)).toBe(false);
    }
  }
  // Edge to edge: bays + the gaps between them ARE the field.
  const inner = (w - 2 * GEOMETRY.edge) * (h - 2 * GEOMETRY.edge);
  const covered = bays.reduce((s, b) => s + area(b.rect), 0);
  expect(covered / inner).toBeGreaterThan(0.86);
  // Tiles fill their bays: no band of empty bay either.
  const bodies = bays.reduce((s, b) => s + area(body(b)), 0);
  const tiles = bays.reduce((s, b) => s + b.tiles.reduce((t, r) => t + area(r), 0), 0);
  expect(tiles / bodies).toBeGreaterThan(0.6);
  // One fleet, one tile size (within a factor): headcount sets bay area.
  const sizes = bays.map((b) => area(b.tiles[0]!));
  expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(3.2);
}

describe('layoutField', () => {
  for (const [label, w, h] of SIZES) {
    it(`packs the real fleet edge to edge at ${label}`, () => {
      const bays = layoutField(REAL, w, h);
      checkField(bays, REAL, w, h);
      const big = bays.find((b) => b.id === 'big')!;
      const solo = bays.find((b) => b.id === 'solo-0')!;
      // Area follows headcount; a singleton is compact, never a column.
      expect(area(solo.rect)).toBeLessThan(area(big.rect) / 5);
      expect(Math.max(solo.rect.w / solo.rect.h, solo.rect.h / solo.rect.w)).toBeLessThan(2.6);
      // Thirty personas on a laptop field read at medium size or better.
      expect(solo.tier).not.toBe('small');
    });

    it(`packs a 100-persona simulation edge to edge at ${label}`, () => {
      const bays = layoutField(SIM, w, h);
      checkField(bays, SIM, w, h);
      for (const bay of bays) {
        // Initials + glyph stay legible at the smallest window.
        expect(bay.tiles[0]!.w).toBeGreaterThanOrEqual(44);
        expect(bay.tiles[0]!.h).toBeGreaterThanOrEqual(36);
      }
    });
  }

  it('gives the big window bigger tiles than the laptop', () => {
    const small = layoutField(SIM, 1014, 528)[0]!.tiles[0]!;
    const large = layoutField(SIM, 1594, 808)[0]!.tiles[0]!;
    expect(area(large)).toBeGreaterThan(area(small) * 1.8);
  });

  it('draws nothing for an empty fleet or an unmeasured field', () => {
    expect(layoutField([], 1000, 500)).toEqual([]);
    expect(layoutField([{ id: 'a', count: 0 }], 1000, 500)).toEqual([]);
    expect(layoutField(SIM, 0, 0)).toEqual([]);
  });

  it('is deterministic and keeps the input order', () => {
    const a = layoutField(REAL, 1014, 528);
    const b = layoutField(REAL, 1014, 528);
    expect(a).toEqual(b);
  });
});

describe('squarify', () => {
  it('tiles the rect exactly', () => {
    const rect = { x: 0, y: 0, w: 600, h: 400 };
    const areas = [6, 6, 4, 3, 2, 2, 1].map((a) => (a / 24) * 240_000);
    const rects = squarify(areas, rect);
    expect(rects.reduce((s, r) => s + area(r), 0)).toBeCloseTo(240_000, 0);
    rects.forEach((r, i) => expect(area(r)).toBeCloseTo(areas[i]!, 0));
  });
});

describe('fitTiles / tierOf', () => {
  it('picks a grid whose tiles keep a readable aspect', () => {
    const g = fitTiles(12, 400, 300, 6);
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(12);
    expect(g.tw / g.th).toBeLessThan(2.5);
    expect(g.tw / g.th).toBeGreaterThan(0.69);
  });

  it('tiers by drawn size', () => {
    expect(tierOf(60, 50)).toBe('small');
    expect(tierOf(120, 90)).toBe('medium');
    expect(tierOf(200, 150)).toBe('large');
  });
});
