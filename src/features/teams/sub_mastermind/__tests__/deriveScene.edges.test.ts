import { describe, it, expect } from 'vitest';

import type { CrossProjectMetadataMap } from '@/api/devTools/devTools';

import { deriveScene } from '../lib/deriveScene';
import type { IslandEdge } from '../lib/types';
import { makePassport } from './passportFactory';

type Relation = CrossProjectMetadataMap['cross_project']['relations'][number];
type Similarity = CrossProjectMetadataMap['cross_project']['similarity_matrix'][number];

function meta(relations: Relation[], similarity: Similarity[]): CrossProjectMetadataMap {
  return {
    projects: [],
    cross_project: {
      shared_keywords: [],
      similarity_matrix: similarity,
      tech_distribution: [],
      relations,
    },
    generated_at: '2026-07-23T00:00:00Z',
    total_projects: 0,
  };
}

/** Edges derived for a fixed 3-island scene (slugs a, b, c). */
function edgesFor(relations: Relation[], similarity: Similarity[]): IslandEdge[] {
  const passports = ['a', 'b', 'c'].map((slug) => makePassport({ slug }));
  return deriveScene(passports, meta(relations, similarity), false).edges;
}

const rel = (source: string, target: string, type = 'depends'): Relation => ({ source, target, type, details: null });
const sim = (source: string, target: string, similarity: number): Similarity => ({ source, target, similarity });

describe('deriveScene — edge derivation', () => {
  it('explicit relations become relation edges (strength 1, label=type)', () => {
    const edges = edgesFor([rel('a', 'b', 'shares API')], []);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: 'a', to: 'b', kind: 'relation', strength: 1, label: 'shares API' });
  });

  it('similarity ≥ 0.5 becomes a similarity edge carrying the score', () => {
    const edges = edgesFor([], [sim('a', 'b', 0.62)]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: 'a', to: 'b', kind: 'similarity', strength: 0.62, label: null });
  });

  it('similarity below 0.5 is dropped; exactly 0.5 is kept', () => {
    expect(edgesFor([], [sim('a', 'b', 0.49)])).toHaveLength(0);
    expect(edgesFor([], [sim('a', 'b', 0.5)])).toHaveLength(1);
  });

  it('a relation beats a similarity for the same (unordered) pair', () => {
    // Similarity given in the reversed order must still dedup against the relation.
    const edges = edgesFor([rel('a', 'b', 'context map')], [sim('b', 'a', 0.9)]);
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('relation');
    expect(edges[0].label).toBe('context map');
  });

  it('self-loops are skipped (both relation and similarity)', () => {
    expect(edgesFor([rel('a', 'a')], [])).toHaveLength(0);
    expect(edgesFor([], [sim('a', 'a', 0.99)])).toHaveLength(0);
  });

  it('edges to a missing endpoint are skipped', () => {
    expect(edgesFor([rel('a', 'zzz')], [])).toHaveLength(0);
    expect(edgesFor([], [sim('a', 'zzz', 0.8)])).toHaveLength(0);
  });

  it('duplicate relations for the same pair collapse to one edge', () => {
    const edges = edgesFor([rel('a', 'b', 'first'), rel('b', 'a', 'second')], []);
    expect(edges).toHaveLength(1);
    expect(edges[0].label).toBe('first');
  });

  it('null metadata yields no edges', () => {
    const passports = ['a', 'b'].map((slug) => makePassport({ slug }));
    expect(deriveScene(passports, null, false).edges).toEqual([]);
  });
});
