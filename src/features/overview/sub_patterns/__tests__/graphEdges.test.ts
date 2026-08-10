// Pattern-fabric S2 — edge aggregation for the topic graph. The contract that
// matters: intra-cluster edges NEVER become canvas links (they belong to the
// modal), pair keys are direction-free, and a half-resolvable edge still
// serves the modal without ever reaching the canvas.
import { describe, expect, it } from 'vitest';

import { buildEdgeViews, topicClusterKey } from '../graph/graphModel';
import type { KnowledgeItemView } from '../libraryModel';

function item(id: string, topic: string, title = `T-${id}`): KnowledgeItemView {
  return {
    id,
    kind: 'pattern',
    status: 'adopted',
    title,
    statement: '',
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

describe('topicClusterKey', () => {
  it('folds a facet into its cluster — the canvas grain is the cluster', () => {
    expect(topicClusterKey('data/migrations')).toBe('data/migrations');
    expect(topicClusterKey('data/migrations/table-rebuild')).toBe('data/migrations');
    expect(topicClusterKey('data')).toBe('data/general');
    expect(topicClusterKey('')).toBeNull();
  });
});

describe('buildEdgeViews', () => {
  const items = [
    item('a', 'data/migrations'),
    item('b', 'data/migrations'),
    item('c', 'frontend/state'),
    item('d', 'data/migrations/table-rebuild'),
  ];

  it('intra-cluster edges reach the modal but never the canvas', () => {
    const { byPractice, clusterLinks } = buildEdgeViews(
      [{ fromId: 'a', toId: 'b', rel: 'governs', note: null }],
      items,
    );
    expect(clusterLinks).toHaveLength(0);
    expect(byPractice.get('a')).toEqual([
      { rel: 'governs', outgoing: true, otherId: 'b', otherTitle: 'T-b', otherTopicKey: 'data/migrations' },
    ]);
    expect(byPractice.get('b')?.[0]).toMatchObject({ rel: 'governs', outgoing: false, otherId: 'a' });
  });

  it('a facet endpoint folds into its cluster, so facet↔cluster stays intra', () => {
    const { clusterLinks } = buildEdgeViews(
      [{ fromId: 'a', toId: 'd', rel: 'composes_with', note: null }],
      items,
    );
    expect(clusterLinks).toHaveLength(0);
  });

  it('cross-cluster edges aggregate direction-free with counts', () => {
    const { clusterLinks } = buildEdgeViews(
      [
        { fromId: 'a', toId: 'c', rel: 'composes_with', note: null },
        { fromId: 'c', toId: 'b', rel: 'prerequisite', note: null },
      ],
      items,
    );
    expect(clusterLinks).toEqual([{ a: 'data/migrations', b: 'frontend/state', count: 2 }]);
  });

  it('an edge to a vanished pattern serves the modal, never the canvas', () => {
    const { byPractice, clusterLinks } = buildEdgeViews(
      [{ fromId: 'a', toId: 'gone', rel: 'supersedes', note: null }],
      items,
    );
    expect(clusterLinks).toHaveLength(0);
    expect(byPractice.get('a')?.[0]).toMatchObject({
      otherId: 'gone',
      otherTitle: 'gone', // falls back to the id — visible, not silently dropped
      otherTopicKey: null,
    });
    expect(byPractice.has('gone')).toBe(false);
  });
});
