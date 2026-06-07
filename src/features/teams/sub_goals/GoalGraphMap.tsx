/**
 * Map v2 — a pan/zoom/drag React Flow canvas over the project's goals and their
 * parent / dependency edges. Replaces the fixed SVG force graph: nodes are
 * freely draggable (positions persist per project), the minimap + controls make
 * 100+ node graphs navigable, and the three-band semantic-zoom nodes (see
 * GoalNode: progress-ring dot → large-type title card → full metadata card)
 * keep every distance readable, from orbit overview to per-goal detail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Target } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';
import { silentCatch } from '@/lib/silentCatch';
import { goalAdvancingTeams } from '@/api/devTools/devTools';
import { GoalNode } from './GoalNode';
import { buildGoalGraph, type GoalNodeData } from './goalGraphLayout';
import { goalStatusLabel, GOAL_STATUSES, goalStatusMeta } from './goalStatus';
import { GoalAtmosphere } from './goalsTheme';

const nodeTypes = { goal: GoalNode };

const posKey = (projectId: string) => `personas.goalmap.pos.${projectId}`;

function loadPositions(projectId: string): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(posKey(projectId));
    return raw ? (JSON.parse(raw) as Record<string, { x: number; y: number }>) : {};
  } catch (err) {
    silentCatch('GoalGraphMap.loadPositions')(err);
    return {};
  }
}

function savePositions(projectId: string, nodes: Node<GoalNodeData>[]) {
  try {
    const map: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) map[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    localStorage.setItem(posKey(projectId), JSON.stringify(map));
  } catch (err) {
    silentCatch('GoalGraphMap.savePositions')(err);
  }
}

export function GoalGraphMap({
  goals,
  dependencies,
  projectId,
  onGoalClick,
}: {
  goals: DevGoal[];
  dependencies: DevGoalDependency[];
  projectId: string | null;
  onGoalClick?: (goalId: string) => void;
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const dt = t.plugins.dev_tools;

  // O4: which team is advancing each goal (team_assignment.goal_id → team) —
  // surfaced as a badge on the node. Empty until a team assignment advances a
  // goal; refreshes when the goal set changes.
  const [advancingTeams, setAdvancingTeams] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    goalAdvancingTeams()
      .then((rows) => setAdvancingTeams(new Map(rows)))
      .catch(silentCatch('GoalGraphMap.goalAdvancingTeams'));
  }, [goals]);

  const graph = useMemo(
    () => buildGoalGraph({
      goals,
      dependencies,
      savedPositions: projectId ? loadPositions(projectId) : undefined,
      advancingTeams,
    }),
    [goals, dependencies, projectId, advancingTeams],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges] = useEdgesState(graph.edges);

  // Latest nodes (for drag-stop persistence without a stale closure).
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Rebuild when goals/deps change, preserving the user's dragged positions.
  useEffect(() => {
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      return graph.nodes.map((n) => {
        const kept = prevPos.get(n.id);
        return kept ? { ...n, position: kept } : n;
      });
    });
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  const handleNodeDragStop = useCallback(
    (_evt: unknown, _node: Node, dragged: Node[]) => {
      if (!projectId) return;
      const draggedById = new Map(dragged.map((d) => [d.id, d.position]));
      const merged = nodesRef.current.map((n) => {
        const pos = draggedById.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
      savePositions(projectId, merged);
    },
    [projectId],
  );

  const hereCount = useMemo(() => nodes.filter((n) => n.data.here).length, [nodes]);
  const nextCount = useMemo(() => nodes.filter((n) => n.data.next).length, [nodes]);

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Target className="w-10 h-10 text-foreground mb-3" />
        <p className="typo-body text-foreground">{dt.no_goals_constellation}</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-2">
      {/* Legend / orientation bar */}
      <div className="flex items-center gap-3 flex-wrap typo-caption text-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full ring-2 ring-amber-400/70" style={{ backgroundColor: goalStatusMeta('in-progress').map.fill }} />
          {dl.goal_map_here} · {dl.goal_status_in_progress} ({hereCount})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full ring-2 ring-blue-400/60" style={{ backgroundColor: goalStatusMeta('open').map.fill }} />
          {dl.goal_map_next} · {dl.goal_map_next_desc} ({nextCount})
        </span>
        <span className="text-foreground/40">|</span>
        {GOAL_STATUSES.map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: goalStatusMeta(status).map.fill }} />
            {goalStatusLabel(dl, status)}
          </span>
        ))}
        <span className="ml-auto text-foreground/50">{dl.goal_map_drag_hint}</span>
      </div>

      <div
        className="relative rounded-modal border border-primary/10 overflow-hidden"
        style={{ height: '62vh', minHeight: 440 }}
      >
        <GoalAtmosphere />
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={(_, node) => onGoalClick?.((node.data as GoalNodeData).goalId)}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.15}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            className="!bg-transparent"
            nodesConnectable={false}
            edgesFocusable={false}
          >
            <Background gap={26} size={1} className="opacity-20" />
            <Controls
              className="!bg-secondary/60 !border-primary/15 !rounded-modal !shadow-elevation-3 [&>button]:!bg-secondary/80 [&>button]:!border-primary/15 [&>button]:!text-foreground"
              showInteractive={false}
            />
            <MiniMap
              className="!bg-secondary/40 !border-primary/15 !rounded-modal"
              maskColor="rgb(var(--color-background) / 0.6)"
              nodeColor={(n) => (n.data as GoalNodeData).fill}
              pannable
              zoomable
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
