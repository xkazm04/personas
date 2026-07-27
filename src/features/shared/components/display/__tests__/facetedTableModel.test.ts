import { describe, it, expect } from 'vitest';

import {
  buildGroupTree,
  itemsUnderGroup,
  searchItems,
} from '../facetedTableModel';

/* -- Knowledge-shaped rows (ported from libraryModel.test.ts) ---------------- */

interface Practice {
  id: string;
  title: string;
  statement: string;
  topic: string;
}

const practice = (p: Partial<Practice>): Practice => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  title: p.title ?? 'Untitled',
  statement: p.statement ?? '',
  topic: p.topic ?? '',
});

const byTopic = (p: Practice) => p.topic;

describe('buildGroupTree', () => {
  it('derives an arbitrary-depth tree with bubbled totals', () => {
    const items = [
      practice({ topic: 'ui/motion/reveals' }),
      practice({ topic: 'ui/motion' }),
      practice({ topic: 'ui/typography' }),
      practice({ topic: 'performance/db' }),
      practice({ topic: '' }),
    ];
    const tree = buildGroupTree(items, byTopic);

    expect(tree.path).toBe('');
    expect(tree.total).toBe(5); // every item counts at the root
    expect(tree.own).toBe(1); // the untopiced row sits exactly at the root
    const ui = tree.children.find((c) => c.segment === 'ui')!;
    expect(ui.total).toBe(3); // 2 motion + 1 typography
    const motion = ui.children.find((c) => c.segment === 'motion')!;
    expect(motion.total).toBe(2); // reveals + motion-itself
    expect(motion.own).toBe(1);
    expect(motion.children[0]!.segment).toBe('reveals');
    expect(motion.children[0]!.path).toBe('ui/motion/reveals');
  });

  it('sorts children by descending total then name', () => {
    const items = [practice({ topic: 'b' }), practice({ topic: 'a' }), practice({ topic: 'a' })];
    expect(buildGroupTree(items, byTopic).children.map((c) => c.segment)).toEqual(['a', 'b']);
  });

  it('breaks total ties alphabetically', () => {
    const items = [practice({ topic: 'z' }), practice({ topic: 'm' }), practice({ topic: 'a' })];
    expect(buildGroupTree(items, byTopic).children.map((c) => c.segment)).toEqual(['a', 'm', 'z']);
  });

  it('creates intermediate nodes that hold no items of their own', () => {
    const tree = buildGroupTree([practice({ topic: 'a/b/c' })], byTopic);
    const a = tree.children[0]!;
    expect(a.own).toBe(0);
    expect(a.total).toBe(1);
    expect(a.children[0]!.children[0]!.own).toBe(1);
  });

  it('returns an empty root for an empty corpus', () => {
    const tree = buildGroupTree([], byTopic);
    expect(tree.total).toBe(0);
    expect(tree.children).toEqual([]);
  });
});

describe('itemsUnderGroup', () => {
  const items = [
    practice({ id: 'a', topic: 'ui/motion/reveals' }),
    practice({ id: 'b', topic: 'ui/motion' }),
    practice({ id: 'c', topic: 'ui/typography' }),
    practice({ id: 'd', topic: 'performance' }),
  ];

  it('returns everything for the empty (root) path', () => {
    expect(itemsUnderGroup(items, byTopic, '')).toHaveLength(4);
  });

  it('returns a node and all descendants, not sibling prefixes', () => {
    const under = itemsUnderGroup(items, byTopic, 'ui/motion')
      .map((i) => i.id)
      .sort();
    expect(under).toEqual(['a', 'b']);
    expect(under).not.toContain('c');
  });

  it('does not match a partial segment prefix', () => {
    expect(itemsUnderGroup(items, byTopic, 'ui/mot')).toHaveLength(0);
  });

  it('copies rather than aliasing the input for the root path', () => {
    const out = itemsUnderGroup(items, byTopic, '');
    expect(out).not.toBe(items);
  });
});

describe('searchItems', () => {
  const items = [
    practice({ title: 'Prefer sticky headers', statement: 'x', topic: 'ui' }),
    practice({ title: 'Avoid N+1', statement: 'query batching', topic: 'perf/db' }),
  ];
  const haystack = (p: Practice) => [p.title, p.statement, p.topic];

  it('matches any haystack field case-insensitively', () => {
    expect(searchItems(items, 'STICKY', haystack)).toHaveLength(1);
    expect(searchItems(items, 'batching', haystack)).toHaveLength(1);
    expect(searchItems(items, 'perf/db', haystack)).toHaveLength(1);
  });

  it('returns a copy of all items for an empty query', () => {
    const out = searchItems(items, '   ', haystack);
    expect(out).toHaveLength(2);
    expect(out).not.toBe(items);
  });

  it('only searches the fields the haystack exposes', () => {
    const titleOnly = (p: Practice) => [p.title];
    expect(searchItems(items, 'batching', titleOnly)).toHaveLength(0);
  });
});

/* -- Idea-shaped rows: a composed `category/origin` group path --------------- */

interface IdeaRow {
  id: string;
  title: string;
  category: string;
  origin: string | null;
}

const ideaPath = (r: IdeaRow) => `${r.category}/${r.origin ?? 'scanner'}`;

describe('a DevIdea-shaped row grouped by category/origin', () => {
  const ideas: IdeaRow[] = [
    { id: '1', title: 'Cache the tree', category: 'performance', origin: 'llm_cost' },
    { id: '2', title: 'Drop the N+1', category: 'performance', origin: 'llm_cost' },
    { id: '3', title: 'Adopt workspace practice: tokens', category: 'design', origin: 'workspace_practice' },
    { id: '4', title: 'Untriaged scan hit', category: 'design', origin: null },
  ];

  it('derives the two-level facet rail from composed paths', () => {
    const tree = buildGroupTree(ideas, ideaPath);
    expect(tree.total).toBe(4);
    expect(tree.children.map((c) => c.segment)).toEqual(['design', 'performance']);
    const design = tree.children.find((c) => c.segment === 'design')!;
    expect(design.own).toBe(0);
    expect(design.children.map((c) => c.segment).sort()).toEqual([
      'scanner',
      'workspace_practice',
    ]);
    const perf = tree.children.find((c) => c.segment === 'performance')!;
    expect(perf.children).toHaveLength(1);
    expect(perf.children[0]!.total).toBe(2);
  });

  it('selects a whole category branch or a single origin leaf', () => {
    expect(itemsUnderGroup(ideas, ideaPath, 'design').map((i) => i.id)).toEqual(['3', '4']);
    expect(itemsUnderGroup(ideas, ideaPath, 'design/scanner').map((i) => i.id)).toEqual(['4']);
  });

  it('searches idea titles independently of the group accessor', () => {
    const found = searchItems(ideas, 'n+1', (r) => [r.title, r.category]);
    expect(found.map((i) => i.id)).toEqual(['2']);
  });
});
