import { describe, expect, it } from 'vitest';

import { categoryNodes, CATEGORY_ORDER, rollupStatus, STATUS_RANK } from '../lib/dimCategories';
import { DIM_ORDER, DIM_REGISTRY } from '../lib/dimRegistry';
import type { DimNode, DimStatus } from '../lib/types';

const node = (key: DimNode['key'], status: DimStatus): DimNode => ({
  key, label: key, status, detail: null, reached: 0, steps: 0,
});

describe('dimCategories — rollupStatus', () => {
  it('an empty group has nothing to say', () => {
    expect(rollupStatus([])).toBe('absent');
  });

  it('any alert is the headline, even among green', () => {
    expect(rollupStatus(['solid', 'solid', 'alert'])).toBe('alert');
    expect(rollupStatus(['risk', 'alert'])).toBe('alert');
  });

  it('risk outranks everything below it', () => {
    expect(rollupStatus(['solid', 'risk', 'absent'])).toBe('risk');
  });

  it('a failed data family never reads as healthy', () => {
    expect(rollupStatus(['solid', 'solid', 'unknown'])).toBe('unknown');
  });

  it('all-absent stays absent — nothing here is set up', () => {
    expect(rollupStatus(['absent', 'absent'])).toBe('absent');
  });

  it('green requires EVERY member green', () => {
    expect(rollupStatus(['solid', 'solid'])).toBe('solid');
    expect(rollupStatus(['solid', 'absent'])).toBe('partial');
    expect(rollupStatus(['solid', 'partial'])).toBe('partial');
  });
});

describe('dimCategories — STATUS_RANK', () => {
  it('sorts a mixed list worst-first, green last', () => {
    const mixed: DimStatus[] = ['solid', 'absent', 'alert', 'partial', 'unknown', 'risk'];
    expect([...mixed].sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b]))
      .toEqual(['alert', 'risk', 'unknown', 'partial', 'absent', 'solid']);
  });

  it('agrees with the rollup: whatever ranks first in a group is what it paints', () => {
    for (const pair of [['solid', 'alert'], ['absent', 'risk'], ['partial', 'unknown']] as DimStatus[][]) {
      const worst = [...pair!].sort((a, b) => STATUS_RANK[a!] - STATUS_RANK[b!])[0];
      expect(rollupStatus(pair!)).toBe(worst);
    }
  });
});

describe('dimCategories — categoryNodes', () => {
  const all = DIM_ORDER.map((k) => node(k, 'solid'));

  it('covers every dimension exactly once across the categories', () => {
    const cats = categoryNodes(all);
    const covered = cats.flatMap((c) => c.nodes.map((n) => n.key));
    expect(covered.slice().sort()).toEqual(DIM_ORDER.slice().sort());
    expect(cats.reduce((s, c) => s + c.total, 0)).toBe(DIM_ORDER.length);
  });

  it('collapses the full lattice to at most four cells', () => {
    expect(categoryNodes(all).length).toBeLessThanOrEqual(4);
    expect(categoryNodes(all).map((c) => c.key)).toEqual(CATEGORY_ORDER);
  });

  it('emits categories in CATEGORY_ORDER regardless of node order', () => {
    const shuffled = [...all].reverse();
    expect(categoryNodes(shuffled).map((c) => c.key)).toEqual(CATEGORY_ORDER);
  });

  it('drops categories with no members on this island', () => {
    const runtimeOnly = DIM_ORDER.filter((k) => DIM_REGISTRY[k].category === 'runtime').map((k) => node(k, 'solid'));
    expect(categoryNodes(runtimeOnly).map((c) => c.key)).toEqual(['runtime']);
  });

  it('counts solids per category and rolls the status up', () => {
    const nodes = DIM_ORDER.map((k) => node(k, DIM_REGISTRY[k].category === 'product' ? 'alert' : 'solid'));
    const cats = categoryNodes(nodes);
    const product = cats.find((c) => c.key === 'product');
    expect(product?.status).toBe('alert');
    expect(product?.solid).toBe(0);
    expect(cats.find((c) => c.key === 'runtime')?.status).toBe('solid');
    expect(cats.find((c) => c.key === 'runtime')?.solid).toBe(cats.find((c) => c.key === 'runtime')?.total);
  });
});
