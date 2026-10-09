import { describe, expect, it } from 'vitest';

import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';

import { footItems } from '../RelatedItems';

const item = (id: string, source: LifecycleRelatedItem['source']): LifecycleRelatedItem => ({
  id, title: id, status: 'accepted', verifyState: null, source, commandId: null, createdAt: '2026-10-08T08:00:00Z',
});

describe('the backlog items at the foot of a step screen', () => {
  const related = [item('rot', 'doc_rot'), item('ov', 'overseer'), item('slow', 'slow_gate')];

  it('leaves doc-rot items to the Docs step\'s own Fix panel, so they are not listed twice', () => {
    expect(footItems('docs', related).map((i) => i.id)).toEqual(['ov', 'slow']);
  });

  it('lists every source on any other step', () => {
    expect(footItems('gate', related).map((i) => i.id)).toEqual(['rot', 'ov', 'slow']);
  });
});
