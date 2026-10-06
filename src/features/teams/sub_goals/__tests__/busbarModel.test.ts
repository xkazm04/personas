// Busbar's sheet shaping: which project leads, how goals hang from rails, and
// what the rail numbers and the open bus mean. These are the judgements the
// key grammar depends on (a digit binds to rail N, `#NN` is the cursor's
// track), so they are asserted on the pure model rather than through the DOM.
import { describe, expect, it } from 'vitest';

import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { MilestoneLane } from '../progress/milestoneOps';
import type { ProgressRow } from '../progress/useProgressModel';
import { buildProjects, goalPct, railInk } from '../progress/variants/busbar/busbarModel';

function goal(id: string, projectId: string, over: Partial<DevGoal> = {}): DevGoal {
  // Fixture: only the fields the model reads are meaningful.
  return {
    id,
    project_id: projectId,
    parent_goal_id: null,
    order_index: 0,
    created_at: '2026-10-01T00:00:00Z',
    status: 'open',
    progress: 0,
    title: id,
    ...over,
  } as unknown as DevGoal;
}

function row(projectId: string, goals: DevGoal[], activeCount = goals.length): ProgressRow {
  const nodes = goals.map((g) => ({ goal: g, overdue: false, delay: null }));
  return { projectId, name: projectId, goals, activeCount, doneCount: 0, past: [], future: [], undated: nodes, nodes };
}

function lane(id: string, projectId: string, goalIds: string[], status = 'planned'): MilestoneLane {
  return { id, projectId, name: id, status, targetDate: null, goalIds: new Set(goalIds), members: new Map() };
}

describe('buildProjects', () => {
  it('leads with a project that has rails and live work, and letters the sheets in that order', () => {
    const a = row('busy', [goal('a1', 'busy'), goal('a2', 'busy')]);
    const b = row('railed', [goal('b1', 'railed')]);
    const lanes = new Map([['railed', [lane('m1', 'railed', ['b1'])]]]);
    const out = buildProjects([a, b], lanes, [...a.goals, ...b.goals]);
    expect(out.map((p) => [p.row.projectId, p.letter])).toEqual([
      ['railed', 'a'],
      ['busy', 'b'],
    ]);
  });

  it('numbers rails from 1, puts unbound goals on the open bus last, and numbers cards down the sheet', () => {
    const goals = [goal('g1', 'p', { order_index: 2 }), goal('g2', 'p', { order_index: 1 }), goal('g3', 'p')];
    const lanes = new Map([['p', [lane('m1', 'p', ['g1', 'g2'])]]]);
    const [p] = buildProjects([row('p', goals)], lanes, goals);
    expect(p!.bands.map((b) => [b.number, b.lane?.id ?? null])).toEqual([
      [1, 'm1'],
      [0, null],
    ]);
    // order_index decides the order on a rail; numbering runs across rails.
    expect(p!.order).toEqual(['g2', 'g1', 'g3']);
    expect(p!.bands[1]!.goals.map((g) => g.number)).toEqual([3]);
    expect(p!.unassigned).toBe(1);
  });

  it('hangs a sub-goal right after its parent when both are on the same rail', () => {
    const goals = [
      goal('parent', 'p', { order_index: 1 }),
      goal('other', 'p', { order_index: 2 }),
      goal('child', 'p', { order_index: 3, parent_goal_id: 'parent' }),
    ];
    const [p] = buildProjects([row('p', goals)], new Map([['p', []]]), goals);
    const open = p!.bands[0]!;
    expect(open.goals.map((g) => [g.node.goal.id, g.sub])).toEqual([
      ['parent', false],
      ['child', true],
      ['other', false],
    ]);
  });

  it('counts a rail over every goal bound to it, including ones the done-filter hides', () => {
    const shown = goal('live', 'p', { progress: 40 });
    const hidden = goal('old', 'p', { status: 'done' });
    const lanes = new Map([['p', [lane('m1', 'p', ['live', 'old'])]]]);
    const [p] = buildProjects([row('p', [shown])], lanes, [shown, hidden]);
    const rail = p!.bands[0]!;
    expect(rail.goals).toHaveLength(1);
    expect([rail.total, rail.done, rail.avg]).toEqual([2, 1, 70]);
  });
});

describe('inks and percentages', () => {
  it('draws the open bus in text ink and cycles rail inks by number', () => {
    expect(railInk(0)).toContain('--foreground');
    expect(railInk(1)).toBe(railInk(6));
    expect(railInk(1)).not.toBe(railInk(2));
  });

  it('reads a done goal as complete whatever its stored progress says', () => {
    expect(goalPct(goal('x', 'p', { status: 'done', progress: 10 }))).toBe(100);
    expect(goalPct(goal('y', 'p', { progress: 140 }))).toBe(100);
  });
});
