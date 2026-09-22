import { describe, it, expect } from 'vitest';

import { squarify, type Rect, type TreemapCell, type TreemapItem } from '../variants/squarify';

const RECT: Rect = { x: 0, y: 0, w: 600, h: 420 };

function overlaps(a: TreemapCell, b: TreemapCell): boolean {
  const EPS = 1e-6;
  return (
    a.x + a.w - EPS > b.x && b.x + b.w - EPS > a.x && a.y + a.h - EPS > b.y && b.y + b.h - EPS > a.y
  );
}

function expectNoOverlap(cells: TreemapCell[]): void {
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      expect(overlaps(cells[i]!, cells[j]!), `${cells[i]!.key} vs ${cells[j]!.key}`).toBe(false);
    }
  }
}

function expectInside(cells: TreemapCell[], rect: Rect): void {
  const EPS = 1e-6;
  for (const c of cells) {
    expect(c.x).toBeGreaterThanOrEqual(rect.x - EPS);
    expect(c.y).toBeGreaterThanOrEqual(rect.y - EPS);
    expect(c.x + c.w).toBeLessThanOrEqual(rect.x + rect.w + EPS);
    expect(c.y + c.h).toBeLessThanOrEqual(rect.y + rect.h + EPS);
  }
}

describe('squarify', () => {
  it('returns nothing for an empty list or a degenerate rect', () => {
    expect(squarify([], RECT)).toEqual([]);
    expect(squarify([{ key: 'a', value: 5 }], { x: 0, y: 0, w: 0, h: 100 })).toEqual([]);
    expect(squarify([{ key: 'a', value: 5 }], { x: 0, y: 0, w: 100, h: -1 })).toEqual([]);
  });

  it('skips zero- and negative-valued items — a 0px cell would be a claim about nothing', () => {
    const cells = squarify(
      [{ key: 'a', value: 4 }, { key: 'zero', value: 0 }, { key: 'neg', value: -3 }],
      RECT,
    );
    expect(cells.map((c) => c.key)).toEqual(['a']);
  });

  it('gives each cell an area proportional to its value', () => {
    const items: TreemapItem[] = [
      { key: 'a', value: 6 }, { key: 'b', value: 6 }, { key: 'c', value: 4 },
      { key: 'd', value: 3 }, { key: 'e', value: 2 }, { key: 'f', value: 1 },
    ];
    const cells = squarify(items, RECT);
    const total = items.reduce((s, i) => s + i.value, 0);
    const area = RECT.w * RECT.h;
    expect(cells).toHaveLength(items.length);
    for (const item of items) {
      const cell = cells.find((c) => c.key === item.key)!;
      expect(cell.w * cell.h).toBeCloseTo((item.value / total) * area, 4);
    }
  });

  it('tiles the container: no overlaps, everything inside, areas sum to the whole', () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ key: `k${i}`, value: (i % 7) + 1 }));
    const cells = squarify(items, { x: 10, y: 20, w: 480, h: 300 });
    expectNoOverlap(cells);
    expectInside(cells, { x: 10, y: 20, w: 480, h: 300 });
    const sum = cells.reduce((s, c) => s + c.w * c.h, 0);
    expect(sum).toBeCloseTo(480 * 300, 2);
  });

  it('sorts value-descending, so the largest cell comes first', () => {
    const cells = squarify(
      [{ key: 'small', value: 1 }, { key: 'big', value: 40 }, { key: 'mid', value: 9 }],
      RECT,
    );
    expect(cells[0]!.key).toBe('big');
    const areas = cells.map((c) => c.w * c.h);
    expect(areas[0]!).toBeGreaterThan(areas[1]!);
    expect(areas[1]!).toBeGreaterThan(areas[2]!);
  });

  it('keeps aspect ratios readable rather than slicing (that is the point of squarified)', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, value: 12 - i }));
    const cells = squarify(items, RECT);
    for (const c of cells) {
      const ratio = Math.max(c.w / c.h, c.h / c.w);
      expect(ratio).toBeLessThan(8);
    }
  });

  it('places a single item as the whole rect', () => {
    const cells = squarify([{ key: 'only', value: 3 }], RECT);
    expect(cells).toEqual([{ key: 'only', x: 0, y: 0, w: 600, h: 420 }]);
  });
});
