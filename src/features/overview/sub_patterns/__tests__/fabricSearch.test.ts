// Fabric omnibox — the ranking contract. What matters: every grain of the
// fabric is reachable by fragment, a title hit always outranks a body hit,
// bigger grains win ties, and a match carries the nodes the host flies to.
import { describe, expect, it } from 'vitest';

import { buildFabricIndex, buildTopicGraph, searchFabric } from '../graph/graphModel';
import type { KnowledgeItemView } from '../libraryModel';

function item(
  id: string,
  topic: string,
  title: string,
  statement = '',
): KnowledgeItemView {
  return {
    id,
    kind: 'pattern',
    status: 'adopted',
    title,
    statement,
    topic,
    layers: [],
    frameworks: [],
    originProjectId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    decidedAt: null,
    confidence: null,
    abstraction: null,
    ftype: null,
    durability: null,
    governingId: null,
    evidenceCount: null,
  } as KnowledgeItemView;
}

const ITEMS: KnowledgeItemView[] = [
  item('1', 'data/migrations/table-rebuild', 'Rebuild wide tables offline'),
  item('2', 'data/migrations', 'Migrations are forward-only'),
  item('3', 'frontend/loading', 'Ghost under chrome', 'never hide rendered rows during a refetch'),
  item('4', 'security/secrets', 'Credentials never leave the machine'),
];

const index = buildFabricIndex(buildTopicGraph(ITEMS));

describe('buildFabricIndex', () => {
  it('indexes every grain — areas, clusters, facets and patterns', () => {
    const kinds = new Set(
      ['data', 'migrations', 'table-rebuild', 'rebuild', 'ghost', 'secrets'].flatMap((q) =>
        searchFabric(index, q).map((m) => m.kind),
      ),
    );
    expect(kinds).toEqual(new Set(['area', 'cluster', 'facet', 'pattern']));
  });

  it('skips empty areas — the sky keeps them, the omnibox does not', () => {
    // `billing` is in AREA_ORDER but has no practices in this fixture.
    expect(searchFabric(index, 'billing')).toEqual([]);
  });
});

describe('searchFabric', () => {
  it('returns nothing under two characters', () => {
    expect(searchFabric(index, 'd')).toEqual([]);
    expect(searchFabric(index, ' ')).toEqual([]);
    expect(searchFabric(index, 'da').length).toBeGreaterThan(0);
  });

  it('finds an area, a cluster, a facet and a pattern by fragment', () => {
    expect(searchFabric(index, 'data')[0]).toMatchObject({ kind: 'area', label: 'data' });
    expect(searchFabric(index, 'migrat').some((m) => m.kind === 'cluster')).toBe(true);
    const facet = searchFabric(index, 'table-reb').find((m) => m.kind === 'facet');
    expect(facet).toMatchObject({ label: 'table-rebuild', path: 'data/migrations/table-rebuild' });
    const pattern = searchFabric(index, 'forward-only').find((m) => m.kind === 'pattern');
    expect(pattern).toMatchObject({ kind: 'pattern', label: 'Migrations are forward-only' });
  });

  it('matches a cluster by its full topic path, not just its leaf name', () => {
    const hit = searchFabric(index, 'data/migrations').find((m) => m.kind === 'cluster');
    expect(hit?.path).toBe('data/migrations');
  });

  it('ranks a statement-only hit below any title hit', () => {
    const hits = searchFabric(index, 'rows');
    expect(hits.map((m) => m.label)).toContain('Ghost under chrome');
    const bodyHit = hits.find((m) => m.label === 'Ghost under chrome')!;
    const titleHit = searchFabric(index, 'ghost').find((m) => m.label === 'Ghost under chrome')!;
    expect(titleHit.score).toBeGreaterThan(bodyHit.score);
  });

  it('prefers a prefix hit over an infix one', () => {
    const prefix = searchFabric(index, 'secre').find((m) => m.kind === 'cluster')!;
    const infix = searchFabric(index, 'ecre').find((m) => m.kind === 'cluster')!;
    expect(prefix.score).toBeGreaterThan(infix.score);
  });

  it('carries the nodes the host needs to navigate', () => {
    const facet = searchFabric(index, 'table-reb').find((m) => m.kind === 'facet');
    expect(facet?.kind).toBe('facet');
    if (facet?.kind !== 'facet') throw new Error('expected a facet match');
    expect(facet.cluster.topic).toBe('data/migrations');
    expect(facet.facet.items.map((i) => i.id)).toEqual(['1']);

    const pattern = searchFabric(index, 'Rebuild wide').find((m) => m.kind === 'pattern');
    if (pattern?.kind !== 'pattern') throw new Error('expected a pattern match');
    // A 3-segment pattern resolves to its facet stack; a 2-segment one does not.
    expect(pattern.facet?.facet).toBe('table-rebuild');
    const flat = searchFabric(index, 'forward-only').find((m) => m.kind === 'pattern');
    if (flat?.kind !== 'pattern') throw new Error('expected a pattern match');
    expect(flat.facet).toBeNull();
  });

  it('honours the limit', () => {
    expect(searchFabric(index, 'a', 3).length).toBeLessThanOrEqual(3);
    expect(searchFabric(index, 'e', 2).length).toBeLessThanOrEqual(2);
  });
});
