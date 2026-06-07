/**
 * Layout + data shaping for the React Flow goal map (`GoalGraphMap`).
 *
 * Seeds node positions with the pure-JS force sim (`forceLayout.ts`) so a fresh
 * graph opens already spread out, then lets the user drag nodes freely (saved
 * positions win over the sim). Edges carry the parent/blocks/follows relation;
 * node data carries the status colour, progress, and the "here / next" flags
 * the map uses to highlight where the user is and what's unblocked.
 */
import type { Node, Edge } from '@xyflow/react';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';
import {
  goalStatusMeta, normalizeGoalStatus, isComplete, isInProgress, isOpen, isOngoing, type GoalStatus,
} from './goalStatus';
import { goalPreview } from './goalPreview';
import { runForceSimulation, nodeRadius, type NodePos } from './forceLayout';

export type GoalEdgeType = 'parent' | 'blocks' | 'follows';

export interface GoalNodeData extends Record<string, unknown> {
  goalId: string;
  title: string;
  status: GoalStatus;
  progress: number;
  /** Status fill / stroke (from the canonical status model) — also drives the minimap. */
  fill: string;
  stroke: string;
  /** Currently in progress — "you are here". */
  here: boolean;
  /** Open and unblocked — a sensible next step. */
  next: boolean;
  /** Name of the team whose assignment is advancing this goal (O4), if any. */
  advancingTeam?: string | null;
  /** Markdown-flattened description preview for the detail zoom band —
   *  computed once per graph build, not per zoom frame. */
  description: string | null;
  /** ISO target date (detail band meta row). */
  targetDate: string | null;
  /** Ongoing goal past its target date — the detail band paints the date red. */
  overdue: boolean;
}

/** Data for the per-status cluster label rendered at far zoom (GoalClusterNode). */
export interface GoalClusterData extends Record<string, unknown> {
  status: GoalStatus;
  count: number;
  fill: string;
}

// Force-sim canvas — larger than the viewport so 100+ nodes have room to breathe.
const LAYOUT_W = 1400;
const LAYOUT_H = 900;

/**
 * Group-gravity anchors: each canonical status claims a quadrant, so the
 * zoomed-out constellation reads as regions ("that pile is blocked work")
 * instead of an undifferentiated scatter. Mirrors the board's left-to-right
 * your-turn → agent's-turn → done flow on the top row; trouble sinks bottom-left.
 */
const STATUS_ANCHORS = new Map<string, { x: number; y: number }>([
  ['open', { x: LAYOUT_W * 0.24, y: LAYOUT_H * 0.32 }],
  ['in-progress', { x: LAYOUT_W * 0.62, y: LAYOUT_H * 0.34 }],
  ['blocked', { x: LAYOUT_W * 0.3, y: LAYOUT_H * 0.78 }],
  ['done', { x: LAYOUT_W * 0.78, y: LAYOUT_H * 0.74 }],
]);

const EDGE_STYLE: Record<GoalEdgeType, { stroke: string; width: number; dash?: string }> = {
  parent: { stroke: 'rgba(139, 92, 246, 0.45)', width: 2 },
  blocks: { stroke: 'rgba(248, 113, 113, 0.5)', width: 1.5, dash: '5 4' },
  follows: { stroke: 'rgba(56, 189, 248, 0.5)', width: 1.5, dash: '4 3' },
};

export interface HereNext {
  here: Set<string>;
  next: Set<string>;
}

/**
 * here = in-progress goals ("you are here"); next = open goals whose every
 * blocker (dependency source + parent goal) is done ("unblocked open"). An open
 * goal with no blockers counts as next — it can be started any time.
 */
export function computeHereNext(goals: DevGoal[], deps: DevGoalDependency[]): HereNext {
  const doneIds = new Set(goals.filter((g) => isComplete(g.status)).map((g) => g.id));
  const blockers = new Map<string, string[]>();
  const push = (id: string, blocker: string) => {
    const arr = blockers.get(id);
    if (arr) arr.push(blocker);
    else blockers.set(id, [blocker]);
  };
  for (const d of deps) push(d.goal_id, d.depends_on_id);
  for (const g of goals) if (g.parent_goal_id) push(g.id, g.parent_goal_id);

  const here = new Set<string>();
  const next = new Set<string>();
  for (const g of goals) {
    if (isInProgress(g.status)) {
      here.add(g.id);
    } else if (isOpen(g.status)) {
      const bs = blockers.get(g.id) ?? [];
      if (bs.every((b) => doneIds.has(b))) next.add(g.id);
    }
  }
  return { here, next };
}

export interface BuildArgs {
  goals: DevGoal[];
  dependencies: DevGoalDependency[];
  /** Per-project dragged positions (localStorage); win over the force sim. */
  savedPositions?: Record<string, { x: number; y: number }>;
  /** goalId → advancing team name (O4); a goal an assignment is working. */
  advancingTeams?: Map<string, string>;
}

export type GoalMapNode = Node<GoalNodeData> | Node<GoalClusterData>;

export function buildGoalGraph({ goals, dependencies, savedPositions, advancingTeams }: BuildArgs): {
  nodes: GoalMapNode[];
  edges: Edge[];
} {
  if (goals.length === 0) return { nodes: [], edges: [] };

  const validIds = new Set(goals.map((g) => g.id));

  // Relationship edges (parent + dependencies), de-duplicated to valid goals.
  const rawEdges: { source: string; target: string; type: GoalEdgeType }[] = [];
  for (const g of goals) {
    if (g.parent_goal_id && validIds.has(g.parent_goal_id)) {
      rawEdges.push({ source: g.parent_goal_id, target: g.id, type: 'parent' });
    }
  }
  for (const d of dependencies) {
    if (!validIds.has(d.depends_on_id) || !validIds.has(d.goal_id)) continue;
    rawEdges.push({
      source: d.depends_on_id,
      target: d.goal_id,
      type: d.dependency_type === 'follows' ? 'follows' : 'blocks',
    });
  }

  // Seed positions via the status-clustered force sim; dragged positions
  // override per-node.
  const sim: NodePos[] = goals.map((g) => ({
    id: g.id, x: 0, y: 0, vx: 0, vy: 0, radius: nodeRadius(g),
    group: normalizeGoalStatus(g.status),
  }));
  const positioned = runForceSimulation(
    sim,
    rawEdges.map((e) => ({ source: e.source, target: e.target })),
    LAYOUT_W, LAYOUT_H,
    120,
    STATUS_ANCHORS,
  );
  const posMap = new Map(positioned.map((p) => [p.id, p]));

  const { here, next } = computeHereNext(goals, dependencies);

  const now = Date.now();
  const nodes: Node<GoalNodeData>[] = goals.map((g) => {
    const meta = goalStatusMeta(g.status);
    const saved = savedPositions?.[g.id];
    const p = posMap.get(g.id);
    const targetTs = g.target_date ? new Date(g.target_date).getTime() : NaN;
    return {
      id: g.id,
      type: 'goal',
      position: saved ?? { x: p?.x ?? 0, y: p?.y ?? 0 },
      data: {
        goalId: g.id,
        title: g.title,
        status: normalizeGoalStatus(g.status),
        progress: g.progress ?? 0,
        fill: meta.map.fill,
        stroke: meta.map.stroke,
        here: here.has(g.id),
        next: next.has(g.id),
        advancingTeam: advancingTeams?.get(g.id) ?? null,
        description: g.description ? goalPreview(g.description) || null : null,
        targetDate: g.target_date,
        overdue: !Number.isNaN(targetTs) && targetTs < now && isOngoing(g.status),
      },
    };
  });

  // Per-status cluster labels (far zoom only — GoalClusterNode hides itself
  // past the dot band). Positioned at the cluster's centroid, floated above
  // its topmost member; computed from the FINAL positions (saved or sim) so
  // the label follows wherever the goals actually sit.
  const clusterNodes: Node<GoalClusterData>[] = [];
  const byStatus = new Map<GoalStatus, { x: number; y: number }[]>();
  for (const n of nodes) {
    const d = n.data as GoalNodeData;
    const arr = byStatus.get(d.status);
    if (arr) arr.push(n.position);
    else byStatus.set(d.status, [n.position]);
  }
  for (const [status, positions] of byStatus) {
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const topY = Math.min(...positions.map((p) => p.y));
    clusterNodes.push({
      id: `cluster:${status}`,
      type: 'goalCluster',
      position: { x: cx, y: topY - 90 },
      draggable: false,
      selectable: false,
      data: { status, count: positions.length, fill: goalStatusMeta(status).map.fill },
    });
  }

  const edges: Edge[] = rawEdges.map((e, i) => {
    const style = EDGE_STYLE[e.type];
    return {
      id: `${e.source}->${e.target}:${i}`,
      source: e.source,
      target: e.target,
      type: 'default',
      animated: e.type === 'blocks',
      style: { stroke: style.stroke, strokeWidth: style.width, strokeDasharray: style.dash },
    };
  });

  return { nodes: [...nodes, ...clusterNodes], edges };
}
