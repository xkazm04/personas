import { describe, expect, it } from 'vitest';

import { overseerGoal, sendPreview } from '../../../journey/__tests__/overseerFixtures';
import { goalTally, isOpenItem, itemState, itemTime, openItemsFor, orderedItems } from '../goalModel';
import { previewPlan } from '../previewModel';

// The Overseer cockpit's two pure models: what each of his items is doing
// (and in which order the reader meets them), and the Send dry run as the
// groups the confirm reads out.

const ORDER = ['frame', 'recall', 'isolate', 'sync', 'gate', 'tests', 'docs', 'commit', 'land', 'record'];

describe('goalModel', () => {
  it('reads every item state from status and verifyState', () => {
    const states = Object.fromEntries(overseerGoal().items.map((i) => [i.stepId, itemState(i)]));
    expect(states).toEqual({
      gate: 'regressed', tests: 'open', land: 'cleared', isolate: 'cleared', record: 'cleared', commit: 'decided',
    });
    expect(itemState({ status: 'delivered', verifyState: null })).toBe('delivered');
    expect(itemState({ status: 'pending', verifyState: null })).toBe('open');
    expect(isOpenItem({ status: 'expired' })).toBe(false);
  });

  it('counts open, closed and set aside', () => {
    expect(goalTally(overseerGoal().items)).toEqual({ open: 2, closed: 3, decided: 1 });
  });

  it('puts what he owes first, then the rest, each in step order', () => {
    const ids = orderedItems(overseerGoal().items, ORDER).map((i) => i.stepId);
    expect(ids).toEqual(['gate', 'tests', 'isolate', 'commit', 'land', 'record']);
  });

  it('dates an item by its update, else by when it was filed', () => {
    expect(itemTime({ createdAt: 'a', updatedAt: null })).toBe('a');
    expect(itemTime({ createdAt: 'a', updatedAt: 'b' })).toBe('b');
  });

  it("lists a step's open items only", () => {
    expect(openItemsFor(overseerGoal(), 'gate').map((i) => i.id)).toEqual(['idea-ov-gate']);
    expect(openItemsFor(overseerGoal(), 'land')).toEqual([]);
    expect(openItemsFor(null, 'gate')).toEqual([]);
  });
});

describe('previewModel', () => {
  it('reads out the four groups in order, the healthy steps as one count', () => {
    const plan = previewPlan(sendPreview(), overseerGoal());
    expect(plan.groups.map((g) => [g.kind, g.rows.map((r) => r.stepId)])).toEqual([
      ['file', ['sync']],
      ['reopen', ['land']],
      ['open', ['gate', 'tests']],
      ['decided', ['commit']],
    ]);
    expect(plan.healthy).toBe(5);
    expect(plan.newGoal).toBe(false);
    expect(plan.nothingNew).toBe(false);
  });

  it("names a decided item's status from the goal, never from the backend's English", () => {
    const decided = previewPlan(sendPreview(), overseerGoal()).groups.find((g) => g.kind === 'decided')!;
    expect(decided.rows[0]!.itemStatus).toBe('rejected');
    // An item the goal does not list: no status to name.
    const unknown = previewPlan(sendPreview(), overseerGoal({ items: [] })).groups.find((g) => g.kind === 'decided')!;
    expect(unknown.rows[0]!.itemStatus).toBeNull();
  });

  it('drops empty groups and says when nothing new will be filed', () => {
    const plan = previewPlan(sendPreview({ willFile: [], willReopen: [], goalId: null }), null);
    expect(plan.groups.map((g) => g.kind)).toEqual(['open', 'decided']);
    expect(plan.nothingNew).toBe(true);
    expect(plan.newGoal).toBe(true);
  });
});
