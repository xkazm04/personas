// Playbook integrity — what counts as a stale membership and what the fabric
// may suggest as its replacement. Only `adopted` patterns are live doctrine; a
// `supersedes` edge outranks a `governs` parent; a candidate that is itself not
// adopted is no candidate at all.
import { describe, expect, it } from 'vitest';

import { playbookStaleMembers, type PatternEdgeLike } from '../graph/graphModel';
import type { KnowledgeItemView } from '../libraryModel';

function item(
  id: string,
  status: KnowledgeItemView['status'],
  title = `T-${id}`,
): KnowledgeItemView {
  return {
    id,
    kind: 'pattern',
    status,
    title,
    statement: '',
    topic: 'data/migrations',
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

const edge = (fromId: string, toId: string, rel: string): PatternEdgeLike => ({
  fromId,
  toId,
  rel,
  note: null,
});

describe('playbookStaleMembers', () => {
  const itemById = new Map([
    ['live', item('live', 'adopted')],
    ['dead', item('dead', 'deprecated')],
    ['rejected', item('rejected', 'rejected')],
    ['heir', item('heir', 'adopted', 'The heir')],
    ['parent', item('parent', 'adopted', 'The parent')],
    ['draft-heir', item('draft-heir', 'proposed')],
  ]);

  it('treats only adopted patterns as live', () => {
    const stale = playbookStaleMembers(
      [{ practiceId: 'live' }, { practiceId: 'dead' }, { practiceId: 'rejected' }],
      itemById,
      [],
    );
    expect(stale.map((s) => s.practiceId)).toEqual(['dead', 'rejected']);
  });

  it('reports a vanished row with a null title rather than dropping it', () => {
    const stale = playbookStaleMembers([{ practiceId: 'gone' }], itemById, []);
    expect(stale).toEqual([{ practiceId: 'gone', title: null, replacementTitle: null }]);
  });

  it('suggests the pattern that supersedes the stale one', () => {
    const stale = playbookStaleMembers([{ practiceId: 'dead' }], itemById, [
      edge('heir', 'dead', 'supersedes'),
    ]);
    expect(stale[0]!.replacementTitle).toBe('The heir');
  });

  it('falls back to the governs parent, but prefers supersedes', () => {
    const governsOnly = playbookStaleMembers([{ practiceId: 'dead' }], itemById, [
      edge('parent', 'dead', 'governs'),
    ]);
    expect(governsOnly[0]!.replacementTitle).toBe('The parent');

    const both = playbookStaleMembers([{ practiceId: 'dead' }], itemById, [
      edge('parent', 'dead', 'governs'),
      edge('heir', 'dead', 'supersedes'),
    ]);
    expect(both[0]!.replacementTitle).toBe('The heir');
  });

  it('ignores non-adopted candidates, the wrong direction and other relations', () => {
    const stale = playbookStaleMembers([{ practiceId: 'dead' }], itemById, [
      edge('draft-heir', 'dead', 'supersedes'),
      edge('dead', 'heir', 'supersedes'),
      edge('heir', 'dead', 'composes_with'),
    ]);
    expect(stale[0]!.replacementTitle).toBeNull();
  });
});
