/**
 * Board + Map — the two consolidated goal surfaces, selected by the Goals L2
 * sub-nav (`variant`). Clicking a goal in either opens the shared
 * GoalDetailDrawer. The Map is a pure-JS force graph (see `forceLayout.ts`) over
 * parent/child + dependency edges; node colour + labels come from the canonical
 * `goalStatus` model.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Target, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';
import * as devApi from '@/api/devTools/devTools';
import GoalKanban from './GoalKanban';
import { GoalDetailDrawer } from './GoalDetailDrawer';
import { GoalEditorModal } from './GoalEditorModal';
import { runForceSimulation, nodeRadius, type NodePos } from './forceLayout';
import { goalStatusMeta, goalStatusLabel, isBlocked, isInProgress, GOAL_STATUSES } from './goalStatus';
import { silentCatch } from '@/lib/silentCatch';

type VariantId = 'board' | 'map';

export default function GoalConstellation({ variant = 'board' }: { variant?: VariantId } = {}) {
  const goals = useSystemStore((s) => s.goals);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);

  const [dependencies, setDependencies] = useState<DevGoalDependency[]>([]);
  // Goal opened in the detail drawer (from a Board card or a Map node), and the
  // goal being edited (the drawer's Edit hands off to GoalEditorModal).
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<DevGoal | null>(null);

  // Consume any pending detail handoff (e.g. from a ContextMap goal-coverage
  // badge click). Read once on mount; clear so it can't refire.
  useEffect(() => {
    const pending = useSystemStore.getState().pendingGoalSpotlightId;
    if (pending) setDetailGoalId(pending);
    useSystemStore.getState().setPendingGoalSpotlightId(null);
  }, []);

  useEffect(() => {
    if (activeProjectId) fetchGoals(activeProjectId);
  }, [activeProjectId, fetchGoals]);

  // Dependencies (Map edges) — only the Map needs them. One project-scoped query
  // (no per-goal fan-out); refetches when the project or goal count changes.
  useEffect(() => {
    if (variant !== 'map' || !activeProjectId || goals.length === 0) return;
    let cancelled = false;
    devApi.listGoalDependenciesForProject(activeProjectId)
      .then((deps) => { if (!cancelled) setDependencies(deps); })
      .catch(silentCatch('GoalConstellation.loadDeps'));
    return () => { cancelled = true; };
  }, [variant, activeProjectId, goals.length]);

  return (
    <div className="space-y-3">
      {variant === 'board' && <GoalKanban onOpenGoal={setDetailGoalId} />}
      {variant === 'map' && (
        <GoalMap goals={goals} dependencies={dependencies} onGoalClick={setDetailGoalId} />
      )}

      <GoalDetailDrawer
        isOpen={!!detailGoalId}
        goalId={detailGoalId}
        onClose={() => setDetailGoalId(null)}
        onEdit={(g) => { setDetailGoalId(null); setEditGoal(g); }}
      />
      {activeProjectId && (
        <GoalEditorModal
          isOpen={!!editGoal}
          editGoal={editGoal}
          projectId={activeProjectId}
          onClose={() => setEditGoal(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map — force-directed SVG graph of goals + their parent/child & dependency edges
// ---------------------------------------------------------------------------

const WIDTH = 800;
const HEIGHT = 500;

function GoalMap({
  goals,
  dependencies,
  onGoalClick,
}: {
  goals: DevGoal[];
  dependencies: DevGoalDependency[];
  onGoalClick?: (goalId: string) => void;
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  // Edges: parent→child + dependency.
  const edges = useMemo(() => {
    const result: { source: string; target: string; type: string }[] = [];
    for (const g of goals) {
      if (g.parent_goal_id) result.push({ source: g.parent_goal_id, target: g.id, type: 'parent' });
    }
    for (const d of dependencies) {
      result.push({ source: d.depends_on_id, target: d.goal_id, type: d.dependency_type });
    }
    return result;
  }, [goals, dependencies]);

  const positions = useMemo(() => {
    if (goals.length === 0) return [];
    const nodes: NodePos[] = goals.map((g) => ({ id: g.id, x: 0, y: 0, vx: 0, vy: 0, radius: nodeRadius(g) }));
    return runForceSimulation(nodes, edges.map((e) => ({ source: e.source, target: e.target })), WIDTH, HEIGHT);
  }, [goals, edges]);

  const posMap = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

  // Adjacency for hover-highlight: hovering a node spotlights it + its direct
  // neighbours and dims everything else, so dependency chains read at a glance.
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const e of edges) { add(e.source, e.target); add(e.target, e.source); }
    return m;
  }, [edges]);
  const isDimmed = (id: string) =>
    hoveredId !== null && id !== hoveredId && !neighbors.get(hoveredId)?.has(id);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, 2)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, 0.4)), []);
  const handleReset = useCallback(() => setZoom(1), []);

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Target className="w-10 h-10 text-foreground mb-3" />
        <p className="typo-body text-foreground">{t.plugins.dev_tools.no_goals_constellation}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={handleZoomIn} title={t.plugins.dev_tools.zoom_in}>
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={handleZoomOut} title={t.plugins.dev_tools.zoom_out}>
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={handleReset} title={t.plugins.dev_tools.reset_view}>
          <Maximize2 className="w-4 h-4" />
        </Button>
        <span className="typo-caption text-foreground ml-2">
          {goals.length} {t.plugins.dev_tools.goals_label} {edges.length} {t.plugins.dev_tools.connections_label}
        </span>
      </div>

      {/* SVG Canvas */}
      <div className="rounded-modal border border-primary/10 bg-background/50 overflow-hidden" style={{ height: HEIGHT * zoom }}>
        <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%" className="select-none">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" className="text-foreground" />
            </marker>
          </defs>

          {edges.map((edge, i) => {
            const s = posMap.get(edge.source);
            const tp = posMap.get(edge.target);
            if (!s || !tp) return null;
            const isParent = edge.type === 'parent';
            const edgeActive = hoveredId === null || edge.source === hoveredId || edge.target === hoveredId;
            return (
              <line
                key={`edge-${i}`}
                x1={s.x} y1={s.y} x2={tp.x} y2={tp.y}
                stroke={isParent ? 'rgba(139, 92, 246, 0.3)' : 'rgba(245, 158, 11, 0.25)'}
                strokeWidth={isParent ? 2 : 1.5}
                strokeDasharray={isParent ? undefined : '4 3'}
                markerEnd="url(#arrowhead)"
                opacity={edgeActive ? 1 : 0.12}
              />
            );
          })}

          {goals.map((goal) => {
            const pos = posMap.get(goal.id);
            if (!pos) return null;
            const colors = goalStatusMeta(goal.status).map;
            const isHovered = hoveredId === goal.id;
            const dimmed = isDimmed(goal.id);
            const r = pos.radius;
            const isStalled = isBlocked(goal.status) || (isInProgress(goal.status) && goal.progress < 10);

            return (
              <g
                key={goal.id}
                onMouseEnter={() => setHoveredId(goal.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onGoalClick?.(goal.id)}
                className="cursor-pointer transition-opacity"
                opacity={dimmed ? 0.2 : 1}
              >
                {isStalled && (
                  <circle cx={pos.x} cy={pos.y} r={r + 6} fill="none" stroke={colors.stroke} strokeWidth={1} opacity={0.4}>
                    <animate attributeName="r" values={`${r + 4};${r + 10};${r + 4}`} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}

                <circle
                  cx={pos.x} cy={pos.y} r={r}
                  fill={colors.fill}
                  stroke={isHovered ? '#fff' : colors.stroke}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  opacity={isHovered ? 1 : 0.85}
                  style={{ filter: isHovered ? `drop-shadow(0 0 8px ${colors.glow})` : undefined }}
                />

                {goal.progress > 0 && goal.progress < 100 && (
                  <circle
                    cx={pos.x} cy={pos.y} r={r - 3}
                    fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={2}
                    strokeDasharray={`${(goal.progress / 100) * (2 * Math.PI * (r - 3))} ${2 * Math.PI * (r - 3)}`}
                    transform={`rotate(-90 ${pos.x} ${pos.y})`}
                  />
                )}

                <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={r > 24 ? 11 : 9} fontWeight={600}>
                  {goal.progress}%
                </text>

                <text x={pos.x} y={pos.y + r + 14} textAnchor="middle" fill="currentColor" className="text-foreground" fontSize={11}>
                  {goal.title.length > 20 ? goal.title.slice(0, 18) + '…' : goal.title}
                </text>

                {isHovered && (
                  <foreignObject x={pos.x - 110} y={pos.y - r - 64} width={220} height={56}>
                    <div className="bg-background/95 border border-primary/20 rounded-card px-3 py-1.5 text-center shadow-elevation-3">
                      <p className="typo-body font-medium text-foreground truncate">{goal.title}</p>
                      <p className="typo-caption text-foreground">{goalStatusLabel(dl, goal.status)} · {goal.progress}%</p>
                      {onGoalClick && (
                        <p className="typo-caption text-primary/80 mt-0.5">{dl.constellation_click_hint}</p>
                      )}
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 typo-caption text-foreground">
        {GOAL_STATUSES.map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: goalStatusMeta(status).map.fill }} />
            {goalStatusLabel(dl, status)}
          </div>
        ))}
        <span className="mx-2">|</span>
        <span>{t.plugins.dev_tools.legend_parent}</span>
        <span>{t.plugins.dev_tools.legend_dependency}</span>
      </div>
    </div>
  );
}
