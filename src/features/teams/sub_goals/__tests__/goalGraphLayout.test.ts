import { describe, it, expect } from 'vitest';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { buildGoalGraph, type GoalNodeData, type GoalClusterData } from '../goalGraphLayout';

function makeGoal(overrides: Partial<DevGoal> = {}): DevGoal {
  return {
    id: 'g1',
    project_id: 'p1',
    parent_goal_id: null,
    context_id: null,
    order_index: 0,
    title: 'Test goal',
    description: null,
    status: 'open',
    progress: 50,
    target_date: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

describe('buildGoalGraph — status clusters', () => {
  it('emits one cluster label node per present status, with member counts', () => {
    const goals = [
      makeGoal({ id: 'a', status: 'open' }),
      makeGoal({ id: 'b', status: 'open' }),
      makeGoal({ id: 'c', status: 'in_progress' }), // normalizes to in-progress
      makeGoal({ id: 'd', status: 'completed' }), // normalizes to done
    ];
    const { nodes } = buildGoalGraph({ goals, dependencies: [] });
    const clusters = nodes.filter((n) => n.type === 'goalCluster');
    const byStatus = new Map(clusters.map((n) => [(n.data as GoalClusterData).status, n.data as GoalClusterData]));

    expect(clusters).toHaveLength(3); // open, in-progress, done — no blocked
    expect(byStatus.get('open')?.count).toBe(2);
    expect(byStatus.get('in-progress')?.count).toBe(1);
    expect(byStatus.get('done')?.count).toBe(1);
    expect(byStatus.has('blocked')).toBe(false);
    // Labels are display-only chrome.
    for (const c of clusters) {
      expect(c.draggable).toBe(false);
      expect(c.selectable).toBe(false);
    }
  });

  it('floats each cluster label above its topmost member', () => {
    const goals = [
      makeGoal({ id: 'a', status: 'open' }),
      makeGoal({ id: 'b', status: 'open' }),
      makeGoal({ id: 'c', status: 'done' }),
    ];
    const { nodes } = buildGoalGraph({ goals, dependencies: [] });
    for (const cluster of nodes.filter((n) => n.type === 'goalCluster')) {
      const status = (cluster.data as GoalClusterData).status;
      const members = nodes.filter(
        (n) => n.type === 'goal' && (n.data as GoalNodeData).status === status,
      );
      const topY = Math.min(...members.map((m) => m.position.y));
      expect(cluster.position.y).toBeLessThan(topY);
    }
  });

  it('groups same-status goals spatially closer than cross-status goals', () => {
    // 3 open + 3 done, no edges — group gravity should separate the piles.
    const goals = [
      makeGoal({ id: 'o1', status: 'open' }),
      makeGoal({ id: 'o2', status: 'open' }),
      makeGoal({ id: 'o3', status: 'open' }),
      makeGoal({ id: 'd1', status: 'done' }),
      makeGoal({ id: 'd2', status: 'done' }),
      makeGoal({ id: 'd3', status: 'done' }),
    ];
    const { nodes } = buildGoalGraph({ goals, dependencies: [] });
    const pos = (id: string) => nodes.find((n) => n.id === id)!.position;
    const centroid = (ids: string[]) => {
      const ps = ids.map(pos);
      return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
    };
    const open = centroid(['o1', 'o2', 'o3']);
    const done = centroid(['d1', 'd2', 'd3']);
    const dist = Math.hypot(open.x - done.x, open.y - done.y);
    // The two status centroids land in distinct regions, not one blob.
    expect(dist).toBeGreaterThan(200);
  });

  it('saved positions win over the sim for goal nodes', () => {
    const goals = [makeGoal({ id: 'a', status: 'open' })];
    const { nodes } = buildGoalGraph({
      goals,
      dependencies: [],
      savedPositions: { a: { x: 42, y: 17 } },
    });
    const a = nodes.find((n) => n.id === 'a')!;
    expect(a.position).toEqual({ x: 42, y: 17 });
  });
});
