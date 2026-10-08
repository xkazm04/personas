import { describe, it, expect } from 'vitest';

import type { MilestoneLane } from '../../../milestoneOps';
import { moveTargets, nextGoalStatuses } from '../goalMoveRules';

function lane(id: string, status = 'planned'): MilestoneLane {
  return {
    id, projectId: 'p', name: `M ${id}`, status, targetDate: null, goalIds: new Set(),
    orderIndex: 0, objective: null, description: null, cutAt: null, shippedAt: null,
  };
}

describe('nextGoalStatuses', () => {
  it('walks open -> in-progress -> done, with blocked as a side step', () => {
    expect(nextGoalStatuses('open')).toEqual(['in-progress']);
    expect(nextGoalStatuses('in-progress')).toEqual(['done', 'blocked']);
    expect(nextGoalStatuses('blocked')).toEqual(['in-progress']);
    expect(nextGoalStatuses('done')).toEqual(['in-progress']);
  });

  it('offers no status write for awaiting_acceptance: the verdicts own that exit', () => {
    expect(nextGoalStatuses('awaiting_acceptance')).toEqual([]);
  });

  it('normalises legacy spellings first', () => {
    expect(nextGoalStatuses('in_progress')).toEqual(['done', 'blocked']);
    expect(nextGoalStatuses('completed')).toEqual(['in-progress']);
  });
});

describe('moveTargets', () => {
  const lanes = [lane('a'), lane('b', 'active'), lane('c', 'shipped')];

  it('lists the other open milestones then Unassigned', () => {
    expect(moveTargets(lanes, 'a')).toEqual([{ id: 'b', name: 'M b' }, { id: null, name: null }]);
  });

  it('never offers a shipped milestone', () => {
    expect(moveTargets(lanes, 'b').map((t) => t.id)).toEqual(['a', null]);
  });

  it('from the Unassigned view does not offer Unassigned again', () => {
    expect(moveTargets(lanes, null)).toEqual([{ id: 'a', name: 'M a' }, { id: 'b', name: 'M b' }]);
  });
});
