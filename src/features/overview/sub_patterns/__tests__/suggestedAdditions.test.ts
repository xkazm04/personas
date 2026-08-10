// Fabric F4 — suggested playbook additions from `extends` edges. The contract:
// only ADOPTED extensions of ADOPTED members are offered, membership dedupes,
// and the suggestion inherits the parent's phase and slots after it. Adding
// stays a curator click — this fn only ever proposes.
import { describe, expect, it } from 'vitest';

import { playbookSuggestedAdditions } from '../graph/graphModel';
import type { KnowledgeItemView } from '../libraryModel';

function item(id: string, status = 'adopted', title = `T-${id}`): KnowledgeItemView {
  return {
    id, kind: 'pattern', status, title, statement: '', topic: 'data/writes/upserts',
    layers: [], frameworks: [], originProjectId: null,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', decidedAt: null,
    confidence: null, abstraction: null, ftype: null, durability: null,
    governingId: null, evidenceCount: null,
  } as KnowledgeItemView;
}

const byId = (items: KnowledgeItemView[]) => new Map(items.map((i) => [i.id, i]));
const member = (practiceId: string, phase = 'during', ordinal = 2) => ({ practiceId, phase, ordinal });
const extend = (child: string, parent: string) => ({ fromId: child, toId: parent, rel: 'extends', note: null });

describe('playbookSuggestedAdditions', () => {
  it('offers an adopted extension of a member, inheriting phase and slotting after it', () => {
    const items = [item('parent'), item('child')];
    const out = playbookSuggestedAdditions([member('parent', 'verify', 5)], byId(items), [extend('child', 'parent')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ extendsTitle: 'T-parent', phase: 'verify', ordinal: 6 });
    expect(out[0]!.item.id).toBe('child');
  });

  it('never suggests non-adopted children, existing members, or duplicates', () => {
    const items = [item('parent'), item('deprecated-child', 'deprecated'), item('already'), item('twice')];
    const out = playbookSuggestedAdditions(
      [member('parent'), member('already')],
      byId(items),
      [
        extend('deprecated-child', 'parent'), // not adopted -> no
        extend('already', 'parent'),          // already a member -> no
        extend('twice', 'parent'),
        extend('twice', 'already'),           // second parent -> still one suggestion
      ],
    );
    expect(out.map((s) => s.item.id)).toEqual(['twice']);
  });

  it('ignores extensions of members that are themselves stale', () => {
    const items = [item('stale-parent', 'deprecated'), item('child')];
    const out = playbookSuggestedAdditions([member('stale-parent')], byId(items), [extend('child', 'stale-parent')]);
    expect(out).toHaveLength(0);
  });
});
