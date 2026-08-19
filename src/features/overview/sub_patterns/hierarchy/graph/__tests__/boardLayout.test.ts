import { describe, expect, it } from 'vitest';

import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';
import type { HierarchySubject } from '@/lib/bindings/HierarchySubject';

import {
  boardHomeK,
  computeBoardLayout,
  BOARD_COL_GAP,
  BOARD_COL_W,
  BOARD_TECH_GAP,
  BOARD_TECH_H,
} from '../boardLayout';
import { buildHierarchyRenderModel } from '../hierarchyGraphModel';

function subject(overrides: Partial<HierarchySubject> & { slug: string }): HierarchySubject {
  return {
    title: overrides.slug,
    summary: '',
    file: `docs/concepts/paths/${overrides.slug}/${overrides.slug}.md`,
    category: null,
    status: 'forged',
    techniques: [],
    sharedTechniques: [],
    applications: [],
    evidence: [],
    counterEvidence: [],
    deviations: [],
    legacyCount: 0,
    ...overrides,
  };
}

function technique(slug: string, subjectSlug: string) {
  return {
    slug,
    subject: subjectSlug,
    title: slug,
    summary: '',
    file: `docs/concepts/paths/${subjectSlug}/techniques/${slug}.md`,
    status: 'forged',
    laws: [],
    sharedWith: [],
  };
}

function makeGraph(): HierarchyGraph {
  return {
    categories: [
      { id: 'a', title: 'Alpha Cat', order: 1 },
      { id: 'b', title: 'Beta Cat', order: 2 },
      { id: 'c', title: 'Empty Cat', order: 3 },
    ],
    subjects: [
      subject({ slug: 'alpha', category: 'a', techniques: ['t1', 't2', 't3'] }),
      subject({ slug: 'beta', category: 'a' }),
      subject({ slug: 'gamma', category: 'a' }),
      subject({ slug: 'delta', category: 'b' }),
    ],
    techniques: [technique('t1', 'alpha'), technique('t2', 'alpha'), technique('t3', 'alpha')],
    laws: [],
    crossLinks: [],
    corpusMap: [],
    warnings: [],
    source: { root: '/repo', present: true, reason: null },
    counts: { subjects: 4, techniques: 3, applications: 0, evidence: 0, legacyMapped: 0 },
  };
}

describe('computeBoardLayout — column integrity', () => {
  it('no vertical overlap within a column (pill rects disjoint), focused or not', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    for (const focus of [null, 'alpha']) {
      const layout = computeBoardLayout(model, focus);
      for (const ring of model.rings) {
        const rects = ring.subjects
          .map((n) => layout.pills.get(n.subject.slug))
          .filter((r): r is NonNullable<typeof r> => r !== undefined)
          .concat(focus && ring.subjects.some((n) => n.subject.slug === focus)
            ? layout.techniqueRows.map((t) => ({ ...t, ring: ring.key }))
            : [])
          .sort((a, b) => a.y - b.y);
        for (let i = 1; i < rects.length; i += 1) {
          expect(rects[i]!.y).toBeGreaterThanOrEqual(rects[i - 1]!.y + rects[i - 1]!.h);
        }
      }
    }
  });

  it("columns' x-ranges are disjoint", () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeBoardLayout(model, null);
    const ranges = model.rings.map((ring) => {
      const xs = ring.subjects
        .map((n) => layout.pills.get(n.subject.slug))
        .filter((r): r is NonNullable<typeof r> => r !== undefined);
      const kp = layout.keystonePos.get(ring.key)!;
      const colLeft = kp.x - BOARD_COL_W / 2;
      // Every pill sits inside its own column footprint.
      for (const r of xs) {
        expect(r.x).toBeGreaterThanOrEqual(colLeft);
        expect(r.x + r.w).toBeLessThanOrEqual(colLeft + BOARD_COL_W);
      }
      return { left: colLeft, right: colLeft + BOARD_COL_W };
    });
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]!.left - ranges[i - 1]!.right).toBeCloseTo(BOARD_COL_GAP, 6);
    }
  });

  it('the empty category keeps its column (keystone present, geography stable)', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeBoardLayout(model, null);
    expect(layout.keystonePos.get('c')).toBeDefined();
    expect(layout.width).toBeCloseTo(3 * BOARD_COL_W + 2 * BOARD_COL_GAP, 6);
  });
});

describe('computeBoardLayout — accordion', () => {
  it('focusing a subject shifts subsequent pills down by exactly the technique-block height', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const base = computeBoardLayout(model, null);
    const focused = computeBoardLayout(model, 'alpha');

    const m = 3; // alpha's technique count
    const blockH = m * (BOARD_TECH_H + BOARD_TECH_GAP);

    // alpha itself does not move.
    expect(focused.pills.get('alpha')!.y).toBeCloseTo(base.pills.get('alpha')!.y, 6);
    // alpha sorts first in its column (heaviest); beta/gamma sit beneath and
    // shift by exactly the inserted block.
    for (const slug of ['beta', 'gamma']) {
      expect(focused.pills.get(slug)!.y - base.pills.get(slug)!.y).toBeCloseTo(blockH, 6);
    }
    // Other columns are untouched.
    expect(focused.pills.get('delta')!.y).toBeCloseTo(base.pills.get('delta')!.y, 6);
    expect(focused.pills.get('delta')!.x).toBeCloseTo(base.pills.get('delta')!.x, 6);

    // The technique rows sit between alpha and beta, indented.
    expect(focused.techniqueRows).toHaveLength(3);
    const alphaRect = focused.pills.get('alpha')!;
    for (const row of focused.techniqueRows) {
      expect(row.y).toBeGreaterThanOrEqual(alphaRect.y + alphaRect.h);
      expect(row.y + row.h).toBeLessThanOrEqual(focused.pills.get('beta')!.y);
      expect(row.x).toBeGreaterThan(alphaRect.x);
    }
    // No focus → no technique rows.
    expect(base.techniqueRows).toHaveLength(0);
  });

  it('subjectPos tracks pill centers and the contract shape holds', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeBoardLayout(model, null);
    for (const [slug, pos] of layout.subjectPos) {
      const rect = layout.pills.get(slug)!;
      expect(pos.x).toBeCloseTo(rect.x + rect.w / 2, 6);
      expect(pos.y).toBeCloseTo(rect.y + rect.h / 2, 6);
      expect(pos.ring).toBe(rect.ring);
    }
  });
});

describe('boardHomeK', () => {
  it('suggests ~0.5 for the real 8-column board and clamps sanely', () => {
    const k8 = boardHomeK(8);
    expect(k8).toBeGreaterThan(0.4);
    expect(k8).toBeLessThan(0.6);
    expect(boardHomeK(1)).toBeLessThanOrEqual(0.9);
    expect(boardHomeK(40)).toBeGreaterThanOrEqual(0.3);
  });
});
