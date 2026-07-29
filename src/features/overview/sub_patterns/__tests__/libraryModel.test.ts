import { describe, it, expect } from 'vitest';

import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

import {
  buildTopicTree,
  itemsUnderTopic,
  nextQueueIndex,
  searchFilter,
  STATUS_RANK,
  viewFromRow,
  type KnowledgeItemView,
} from '../libraryModel';

function view(partial: Partial<KnowledgeItemView>): KnowledgeItemView {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    kind: partial.kind ?? 'pattern',
    status: partial.status ?? 'observed',
    title: partial.title ?? 'Untitled',
    statement: partial.statement ?? '',
    topic: partial.topic ?? '',
    layers: partial.layers ?? [],
    frameworks: partial.frameworks ?? [],
    originProjectId: partial.originProjectId ?? null,
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00Z',
    confidence: partial.confidence ?? null,
  };
}

describe('viewFromRow', () => {
  const base: WorkspaceKnowledge = {
    id: 'k1',
    workspace_id: 'ws1',
    kind: 'pattern',
    title: 'T',
    statement: 'S',
    detail_md: null,
    topic: null,
    applicability: null,
    status: 'observed',
    origin_project_id: null,
    provenance: null,
    confidence: null,
    dedup_key: null,
    superseded_by: null,
    valid_from: null,
    valid_to: null,
    decided_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  };

  it('uses the real topic column when present', () => {
    expect(viewFromRow({ ...base, topic: 'ui/motion' }).topic).toBe('ui/motion');
  });

  it('falls back to applicability.layers[0] for legacy rows without a topic', () => {
    const v = viewFromRow({
      ...base,
      topic: null,
      applicability: JSON.stringify({ layers: ['performance'], frameworks: ['React'] }),
    });
    expect(v.topic).toBe('performance');
    expect(v.frameworks).toEqual(['React']);
  });

  it('tolerates malformed applicability JSON (no throw, empty topic)', () => {
    const v = viewFromRow({ ...base, topic: null, applicability: 'not json' });
    expect(v.topic).toBe('');
    expect(v.layers).toEqual([]);
  });
});

describe('buildTopicTree', () => {
  it('derives an arbitrary-depth tree with bubbled totals', () => {
    const items = [
      view({ topic: 'ui/motion/reveals' }),
      view({ topic: 'ui/motion' }),
      view({ topic: 'ui/typography' }),
      view({ topic: 'performance/db' }),
      view({ topic: '' }),
    ];
    const tree = buildTopicTree(items);

    expect(tree.total).toBe(5); // every item counts at the root
    const ui = tree.children.find((c) => c.segment === 'ui')!;
    expect(ui.total).toBe(3); // 2 motion + 1 typography
    const motion = ui.children.find((c) => c.segment === 'motion')!;
    expect(motion.total).toBe(2); // reveals + motion-itself
    expect(motion.own).toBe(1); // one item sits exactly at ui/motion
    expect(motion.children[0]!.segment).toBe('reveals');
  });

  it('sorts children by descending total then name', () => {
    const items = [
      view({ topic: 'b' }),
      view({ topic: 'a' }),
      view({ topic: 'a' }),
    ];
    const tree = buildTopicTree(items);
    // 'a' has 2, 'b' has 1 → 'a' first despite alphabetical tie-break being secondary
    expect(tree.children.map((c) => c.segment)).toEqual(['a', 'b']);
  });
});

describe('itemsUnderTopic', () => {
  const items = [
    view({ id: 'a', topic: 'ui/motion/reveals' }),
    view({ id: 'b', topic: 'ui/motion' }),
    view({ id: 'c', topic: 'ui/typography' }),
    view({ id: 'd', topic: 'performance' }),
  ];

  it('returns everything for the empty (root) path', () => {
    expect(itemsUnderTopic(items, '')).toHaveLength(4);
  });

  it('returns a node and all descendants, not sibling prefixes', () => {
    const under = itemsUnderTopic(items, 'ui/motion').map((i) => i.id).sort();
    expect(under).toEqual(['a', 'b']);
    // 'ui/typography' must not leak in via a loose prefix match
    expect(under).not.toContain('c');
  });
});

describe('searchFilter', () => {
  const items = [
    view({ title: 'Prefer sticky headers', statement: 'x', topic: 'ui' }),
    view({ title: 'Avoid N+1', statement: 'query batching', topic: 'perf/db' }),
  ];

  it('matches title, statement, or topic case-insensitively', () => {
    expect(searchFilter(items, 'STICKY')).toHaveLength(1);
    expect(searchFilter(items, 'batching')).toHaveLength(1);
    expect(searchFilter(items, 'perf/db')).toHaveLength(1);
  });

  it('returns a copy of all items for an empty query', () => {
    const out = searchFilter(items, '   ');
    expect(out).toHaveLength(2);
    expect(out).not.toBe(items);
  });
});

describe('STATUS_RANK', () => {
  it('orders the proposal queue before canon before the retired tail', () => {
    const order = (['rejected', 'proposed', 'adopted', 'observed', 'deprecated'] as const)
      .slice()
      .sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b]);
    expect(order).toEqual(['proposed', 'observed', 'adopted', 'deprecated', 'rejected']);
  });
});

describe('nextQueueIndex', () => {
  const all = () => true;

  it('steps forward and back', () => {
    expect(nextQueueIndex(['a', 'b', 'c'], 0, 1, all)).toBe(1);
    expect(nextQueueIndex(['a', 'b', 'c'], 2, -1, all)).toBe(1);
  });

  it('returns null past either end so the caller closes instead of clamping', () => {
    expect(nextQueueIndex(['a', 'b'], 1, 1, all)).toBeNull();
    expect(nextQueueIndex(['a', 'b'], 0, -1, all)).toBeNull();
  });

  it('skips ids whose row has disappeared', () => {
    const alive = (id: string) => id !== 'b' && id !== 'c';
    expect(nextQueueIndex(['a', 'b', 'c', 'd'], 0, 1, alive)).toBe(3);
  });

  it('returns null when every remaining id is gone', () => {
    expect(nextQueueIndex(['a', 'b', 'c'], 0, 1, (id) => id === 'a')).toBeNull();
  });

  it('handles a single-item queue', () => {
    expect(nextQueueIndex(['a'], 0, 1, all)).toBeNull();
    expect(nextQueueIndex(['a'], 0, -1, all)).toBeNull();
  });
});
