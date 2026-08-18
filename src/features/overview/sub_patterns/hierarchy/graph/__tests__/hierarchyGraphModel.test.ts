import { describe, expect, it } from 'vitest';

import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';
import type { HierarchySubject } from '@/lib/bindings/HierarchySubject';

import {
  aggregateSubjectEdges,
  buildHierarchyRenderModel,
  buildLawCitations,
  computeHierarchyLayout,
  KEYSTONE_RING_R,
  subjectRadius,
  techniqueKey,
  UNASSIGNED_RING,
} from '../hierarchyGraphModel';

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

function makeGraph(): HierarchyGraph {
  return {
    categories: [
      // Deliberately out of declaration order: `order` must win. `operations`
      // is EMPTY and must still keep its spoke.
      { id: 'client-architecture', title: 'Client Architecture', order: 2 },
      { id: 'ui-surfaces', title: 'UI Surfaces', order: 1 },
      { id: 'operations', title: 'Operations', order: 3 },
    ],
    subjects: [
      subject({
        slug: 'table',
        title: 'Table',
        category: 'ui-surfaces',
        techniques: ['pagination', 'sorting'],
      }),
      subject({
        slug: 'feed',
        title: 'Feed',
        category: 'ui-surfaces',
        sharedTechniques: [{ technique: 'pagination', owner: 'table' }],
      }),
      subject({ slug: 'state-sync', title: 'State Sync', category: 'client-architecture' }),
      subject({ slug: 'orphan', title: 'Orphan', category: null }),
    ],
    techniques: [
      {
        slug: 'pagination',
        subject: 'table',
        title: 'Pagination',
        summary: '',
        file: 'docs/concepts/paths/table/techniques/pagination.md',
        status: 'forged',
        laws: ['gate-sees-target'],
        sharedWith: ['feed'],
      },
      {
        slug: 'sorting',
        subject: 'table',
        title: 'Sorting',
        summary: '',
        file: 'docs/concepts/paths/table/techniques/sorting.md',
        status: 'draft',
        laws: ['gate-sees-target', 'count-carries-predicate'],
        sharedWith: [],
      },
    ],
    laws: [
      { id: 'gate-sees-target', title: 'Gate sees target', summary: 'A gate must observe.' },
      { id: 'count-carries-predicate', title: 'Count carries predicate', summary: '' },
    ],
    crossLinks: [
      { from: 'feed', to: 'table', kind: 'technique' },
      { from: 'table', to: 'feed', kind: 'subject' },
      { from: 'feed', to: 'table', kind: 'technique' },
      { from: 'state-sync', to: 'table', kind: 'subject' },
      // Self-link — must be dropped.
      { from: 'table', to: 'table', kind: 'subject' },
    ],
    corpusMap: [],
    warnings: [],
    source: { root: '/repo', present: true, reason: null },
    counts: { subjects: 4, techniques: 2, applications: 0, evidence: 0, legacyMapped: 0 },
  };
}

describe('buildHierarchyRenderModel — category ordering', () => {
  it('orders rings by category order, keeps empty categories, appends unassigned last', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    expect(model.rings.map((r) => r.key)).toEqual([
      'ui-surfaces',
      'client-architecture',
      'operations',
      UNASSIGNED_RING,
    ]);
    // Empty category keeps its ring (its spoke) with zero subjects.
    const ops = model.rings.find((r) => r.key === 'operations');
    expect(ops?.subjects).toHaveLength(0);
    // Unassigned subjects are never dropped.
    const unassigned = model.rings.find((r) => r.key === UNASSIGNED_RING);
    expect(unassigned?.subjects.map((s) => s.subject.slug)).toEqual(['orphan']);
    expect(unassigned?.id).toBeNull();
  });

  it('resolves shared techniques to the owner canonical row and counts them', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const feed = model.rings
      .flatMap((r) => r.subjects)
      .find((s) => s.subject.slug === 'feed');
    expect(feed?.techniques).toHaveLength(1);
    expect(feed?.techniques[0]?.owner).toBe('table');
    expect(feed?.techniques[0]?.tech.subject).toBe('table');
    // The table subject owns both locals.
    const table = model.rings
      .flatMap((r) => r.subjects)
      .find((s) => s.subject.slug === 'table');
    expect(table?.techniques.map((e) => e.owner)).toEqual([null, null]);
    expect(model.totalTechniques).toBe(3); // 2 local + 1 shared use
    expect(model.ringOfSubject.get('orphan')).toBe(UNASSIGNED_RING);
  });
});

describe('aggregateSubjectEdges', () => {
  it('dedupes both directions into one undirected edge with count and kinds', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    expect(model.edges).toHaveLength(2);
    const feedTable = model.edges.find((e) => e.a === 'feed' && e.b === 'table');
    expect(feedTable).toEqual({ a: 'feed', b: 'table', count: 3, kinds: ['subject', 'technique'] });
    const stateTable = model.edges.find((e) => e.a === 'state-sync' && e.b === 'table');
    expect(stateTable?.count).toBe(1);
    expect(stateTable?.kinds).toEqual(['subject']);
  });

  it('drops self-links and sorts kinds without duplicates', () => {
    const edges = aggregateSubjectEdges([
      { from: 'a', to: 'a', kind: 'subject' },
      { from: 'b', to: 'a', kind: 'technique' },
      { from: 'a', to: 'b', kind: 'technique' },
    ]);
    expect(edges).toEqual([{ a: 'a', b: 'b', count: 2, kinds: ['technique'] }]);
  });
});

describe('buildLawCitations', () => {
  it('folds per-law subject and technique sets, including shared-technique borrowers', () => {
    const laws = buildLawCitations(makeGraph());
    // gate-sees-target: cited by pagination + sorting (table) and borrowed by feed.
    expect([...(laws.subjectsByLaw.get('gate-sees-target') ?? [])].sort()).toEqual([
      'feed',
      'table',
    ]);
    expect([...(laws.techniquesByLaw.get('gate-sees-target') ?? [])].sort()).toEqual([
      'table/pagination',
      'table/sorting',
    ]);
    // count-carries-predicate: only sorting, only table.
    expect([...(laws.subjectsByLaw.get('count-carries-predicate') ?? [])]).toEqual(['table']);
    expect([...(laws.techniquesByLaw.get('count-carries-predicate') ?? [])]).toEqual([
      'table/sorting',
    ]);
  });

  it('techniqueKey is owner-canonical', () => {
    const graph = makeGraph();
    expect(techniqueKey(graph.techniques[0]!)).toBe('table/pagination');
  });
});

describe('subjectRadius clamps', () => {
  it('holds the base for zero techniques and the cap for huge counts', () => {
    expect(subjectRadius(0)).toBe(8);
    expect(subjectRadius(-5)).toBe(8);
    expect(subjectRadius(1000)).toBe(22);
  });

  it('is monotonic between the clamps', () => {
    expect(subjectRadius(1)).toBeGreaterThan(subjectRadius(0));
    expect(subjectRadius(9)).toBeGreaterThan(subjectRadius(4));
    expect(subjectRadius(9)).toBeLessThanOrEqual(22);
  });
});

describe('computeHierarchyLayout', () => {
  it('places every ring — empty ones included — evenly on the compass from 12 o’clock', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeHierarchyLayout(model);
    expect(layout.keystonePos.size).toBe(4);
    const first = layout.keystonePos.get('ui-surfaces');
    expect(first?.angle).toBeCloseTo(-Math.PI / 2);
    expect(first?.y).toBeCloseTo(-KEYSTONE_RING_R);
    // The empty category still has a keystone position (its spoke survives).
    expect(layout.keystonePos.get('operations')).toBeDefined();
    // Every subject got a position on its own ring.
    for (const ring of model.rings) {
      for (const node of ring.subjects) {
        const pos = layout.subjectPos.get(node.subject.slug);
        expect(pos).toBeDefined();
        expect(pos?.ring).toBe(ring.key);
      }
    }
  });

  it('marches subjects outward from the keystone, past the ring radius', () => {
    const model = buildHierarchyRenderModel(makeGraph());
    const layout = computeHierarchyLayout(model);
    for (const [slug, pos] of layout.subjectPos) {
      void slug;
      const dist = Math.hypot(pos.x, pos.y);
      expect(dist).toBeGreaterThan(KEYSTONE_RING_R);
    }
  });
});
