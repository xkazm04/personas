import { describe, expect, it } from 'vitest';

import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';
import type { HierarchySubject } from '@/lib/bindings/HierarchySubject';

import {
  atlasTechniqueFan,
  computeAtlasLayout,
  ATLAS_FIRST_BAND_R,
} from '../atlasLayout';
import { buildHierarchyRenderModel, UNASSIGNED_RING } from '../hierarchyGraphModel';

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

/** The REAL distribution shape: 8 categories with subject counts
 *  [26, 20, 20, 11, 9, 8, 6, 5] (105 subjects), one EMPTY 9th category, and
 *  one unassigned orphan riding the trailing pseudo-ring. */
const COUNTS = [26, 20, 20, 11, 9, 8, 6, 5];

function makeGraph(): HierarchyGraph {
  const categories = COUNTS.map((_, i) => ({
    id: `cat-${i}`,
    title: `Category ${i}`,
    order: i + 1,
  }));
  categories.push({ id: 'cat-empty', title: 'Empty Category', order: 99 });
  const subjects: HierarchySubject[] = [];
  COUNTS.forEach((count, i) => {
    for (let j = 0; j < count; j += 1) {
      subjects.push(
        subject({ slug: `cat${i}-s${String(j).padStart(2, '0')}`, category: `cat-${i}` }),
      );
    }
  });
  subjects.push(subject({ slug: 'orphan', category: null }));
  return {
    categories,
    subjects,
    techniques: [],
    laws: [],
    crossLinks: [],
    corpusMap: [],
    warnings: [],
    source: { root: '/repo', present: true, reason: null },
    counts: {
      subjects: subjects.length,
      techniques: 0,
      applications: 0,
      evidence: 0,
      legacyMapped: 0,
    },
  };
}

const TWO_PI = Math.PI * 2;

/** Angle of `a` measured forward from `from`, in [0, 2π). */
function forwardFrom(a: number, from: number): number {
  return ((a - from) % TWO_PI + TWO_PI) % TWO_PI;
}

describe('computeAtlasLayout — sector exclusivity', () => {
  it('places every subject inside its OWN sector angular range (no cross-sector bleed)', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeAtlasLayout(model);
    expect(layout.subjectPos.size).toBe(106);
    for (const ring of model.rings) {
      const sector = layout.sectors.get(ring.key);
      expect(sector).toBeDefined();
      if (!sector) continue;
      const span = sector.end - sector.start;
      for (const node of ring.subjects) {
        const pos = layout.subjectPos.get(node.subject.slug);
        expect(pos).toBeDefined();
        if (!pos) continue;
        expect(pos.ring).toBe(ring.key);
        const angle = Math.atan2(pos.y, pos.x);
        const offset = forwardFrom(angle, sector.start);
        expect(offset).toBeLessThanOrEqual(span + 1e-9);
      }
    }
  });

  it('keeps sectors mutually exclusive with gutters (no overlapping angular ranges)', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeAtlasLayout(model);
    const sectors = model.rings
      .map((r) => layout.sectors.get(r.key))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
    // Consecutive sectors are separated by the gutter; the full sweep closes
    // the circle without overlap.
    let sweep = 0;
    for (let i = 0; i < sectors.length; i += 1) {
      const cur = sectors[i]!;
      const next = sectors[(i + 1) % sectors.length]!;
      expect(cur.end - cur.start).toBeGreaterThan(0);
      const gap = forwardFrom(next.start, cur.end);
      expect(gap).toBeGreaterThan(0.001); // a real gutter, not a touch
      sweep += cur.end - cur.start + gap;
    }
    expect(sweep).toBeCloseTo(TWO_PI, 6);
  });
});

describe('computeAtlasLayout — the collision guarantee', () => {
  it('min pairwise center distance between ANY two subjects >= 56px globally', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeAtlasLayout(model);
    const pts = [...layout.subjectPos.values()];
    let min = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y);
        if (d < min) min = d;
      }
    }
    expect(min).toBeGreaterThanOrEqual(56);
  });

  it('no subject sits inside the keystone belt (all on bands at R >= first band)', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeAtlasLayout(model);
    for (const pos of layout.subjectPos.values()) {
      expect(Math.hypot(pos.x, pos.y)).toBeGreaterThanOrEqual(ATLAS_FIRST_BAND_R - 1e-9);
    }
  });
});

describe('computeAtlasLayout — stable geography', () => {
  it('empty categories keep a slim sector and a keystone', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeAtlasLayout(model);
    const empty = layout.sectors.get('cat-empty');
    expect(empty).toBeDefined();
    expect((empty?.end ?? 0) - (empty?.start ?? 0)).toBeGreaterThan(0);
    expect(layout.keystonePos.get('cat-empty')).toBeDefined();
    // The empty sector's wedge still has a valid outer edge.
    expect(empty?.outerR).toBeGreaterThan(ATLAS_FIRST_BAND_R);
  });

  it('the unassigned pseudo-ring lands somewhere valid', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeAtlasLayout(model);
    const sector = layout.sectors.get(UNASSIGNED_RING);
    expect(sector).toBeDefined();
    expect(layout.keystonePos.get(UNASSIGNED_RING)).toBeDefined();
    const orphan = layout.subjectPos.get('orphan');
    expect(orphan).toBeDefined();
    expect(orphan?.ring).toBe(UNASSIGNED_RING);
    expect(Number.isFinite(orphan?.x)).toBe(true);
    expect(Number.isFinite(orphan?.y)).toBe(true);
    if (!sector || !orphan) return;
    const offset = forwardFrom(Math.atan2(orphan.y, orphan.x), sector.start);
    expect(offset).toBeLessThanOrEqual(sector.end - sector.start + 1e-9);
  });

  it('keystone mid-angles follow the compass sequence from 12 o’clock', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeAtlasLayout(model);
    const first = layout.keystonePos.get('cat-0');
    expect(first?.angle).toBeCloseTo(-Math.PI / 2, 6);
    // Mid-angles march forward ring by ring.
    let prev = -Infinity;
    for (const ring of model.rings) {
      const kp = layout.keystonePos.get(ring.key);
      expect(kp).toBeDefined();
      if (!kp) continue;
      expect(kp.angle).toBeGreaterThan(prev);
      prev = kp.angle;
    }
  });
});

describe('atlasTechniqueFan', () => {
  it('keeps >= 38px arc spacing per ring for the max real fan (15 techniques)', () => {
    const spots = atlasTechniqueFan(15);
    expect(spots).toHaveLength(15);
    // Group by radius (ring) and check consecutive arc spacing.
    const byR = new Map<number, { x: number; y: number }[]>();
    for (const s of spots) {
      const r = Math.round(Math.hypot(s.x, s.y));
      const bucket = byR.get(r);
      if (bucket) bucket.push(s);
      else byR.set(r, [s]);
    }
    for (const [r, ringSpots] of byR) {
      const angles = ringSpots.map((s) => Math.atan2(s.y, s.x)).sort((a, b) => a - b);
      for (let i = 0; i < angles.length; i += 1) {
        const next = angles[(i + 1) % angles.length]!;
        const gap = i === angles.length - 1 ? next + TWO_PI - angles[i]! : next - angles[i]!;
        if (angles.length > 1) expect(gap * r).toBeGreaterThanOrEqual(38 - 1e-6);
      }
    }
    // Rings step outward by 44 from 64.
    const radii = [...byR.keys()].sort((a, b) => a - b);
    expect(radii[0]).toBe(64);
    if (radii.length > 1) expect(radii[1]).toBe(108);
  });
});
