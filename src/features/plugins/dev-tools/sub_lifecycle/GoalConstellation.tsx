import { useState, useEffect, useCallback, useMemo } from 'react';
import { Target, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';
import * as devApi from '@/api/devTools/devTools';
import {
  runForceSimulation, nodeRadius, STATUS_COLORS,
  type NodePos,
} from './goals/forceLayout';

const WIDTH = 800;
const HEIGHT = 500;

export default function GoalConstellation() {
  const goals = useSystemStore((s) => s.goals);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const [dependencies, setDependencies] = useState<DevGoalDependency[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => { if (activeProjectId) fetchGoals(activeProjectId); }, [activeProjectId, fetchGoals]);

  useEffect(() => {
    if (goals.length === 0) return;
    (async () => {
      const allDeps: DevGoalDependency[] = [];
      for (const g of goals) {
        try { allDeps.push(...await devApi.listGoalDependencies(g.id)); } catch { /* skip */ }
      }
      setDependencies(allDeps);
    })();
  }, [goals]);

  const edges = useMemo(() => {
    const result: { source: string; target: string; type: string }[] = [];
    for (const g of goals) { if (g.parent_goal_id) result.push({ source: g.parent_goal_id, target: g.id, type: 'parent' }); }
    for (const d of dependencies) result.push({ source: d.depends_on_id, target: d.goal_id, type: d.dependency_type });
    return result;
  }, [goals, dependencies]);

  const positions = useMemo(() => {
    if (goals.length === 0) return [];
    const nodes: NodePos[] = goals.map((g) => ({ id: g.id, x: 0, y: 0, vx: 0, vy: 0, radius: nodeRadius(g) }));
    return runForceSimulation(nodes, edges.map((e) => ({ source: e.source, target: e.target })), WIDTH, HEIGHT);
  }, [goals, edges]);

  const posMap = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, 2)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, 0.4)), []);

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Target className="w-10 h-10 text-foreground/20 mb-3" />
        <p className="typo-body text-foreground">No goals yet. Create goals in the Projects tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={handleZoomIn} className="p-1.5 rounded-interactive hover:bg-secondary/40 text-foreground"><ZoomIn className="w-4 h-4" /></button>
        <button onClick={handleZoomOut} className="p-1.5 rounded-interactive hover:bg-secondary/40 text-foreground"><ZoomOut className="w-4 h-4" /></button>
        <button onClick={() => setZoom(1)} className="p-1.5 rounded-interactive hover:bg-secondary/40 text-foreground"><Maximize2 className="w-4 h-4" /></button>
        <span className="typo-caption text-foreground/60 ml-2">{goals.length} goals, {edges.length} connections</span>
      </div>

      <div className="rounded-card border border-primary/10 bg-background/50 overflow-hidden" style={{ height: HEIGHT * zoom }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%" className="select-none">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" className="text-foreground/30" />
            </marker>
          </defs>

          {edges.map((edge, i) => {
            const s = posMap.get(edge.source);
            const t = posMap.get(edge.target);
            if (!s || !t) return null;
            const isParent = edge.type === 'parent';
            return (
              <line key={`e-${i}`} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={isParent ? 'rgba(139,92,246,0.3)' : 'rgba(245,158,11,0.25)'}
                strokeWidth={isParent ? 2 : 1.5}
                strokeDasharray={isParent ? undefined : '4 3'} markerEnd="url(#arrowhead)" />
            );
          })}

          {goals.map((goal) => {
            const pos = posMap.get(goal.id);
            if (!pos) return null;
            const colors = (STATUS_COLORS[goal.status] ?? STATUS_COLORS.open)!;
            const isHovered = hoveredId === goal.id;
            const r = pos.radius;
            const isStalled = goal.status === 'blocked' || (goal.status === 'in-progress' && goal.progress < 10);
            return (
              <g key={goal.id} onMouseEnter={() => setHoveredId(goal.id)} onMouseLeave={() => setHoveredId(null)} className="cursor-pointer">
                {isStalled && (
                  <circle cx={pos.x} cy={pos.y} r={r + 6} fill="none" stroke={colors.stroke} strokeWidth={1} opacity={0.4}>
                    <animate attributeName="r" values={`${r+4};${r+10};${r+4}`} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={pos.x} cy={pos.y} r={r} fill={colors.fill}
                  stroke={isHovered ? '#fff' : colors.stroke} strokeWidth={isHovered ? 2.5 : 1.5}
                  opacity={isHovered ? 1 : 0.85}
                  style={{ filter: isHovered ? `drop-shadow(0 0 8px ${colors.glow})` : undefined }} />
                {goal.progress > 0 && goal.progress < 100 && (
                  <circle cx={pos.x} cy={pos.y} r={r-3} fill="none"
                    stroke="rgba(255,255,255,0.4)" strokeWidth={2}
                    strokeDasharray={`${(goal.progress/100)*(2*Math.PI*(r-3))} ${2*Math.PI*(r-3)}`}
                    transform={`rotate(-90 ${pos.x} ${pos.y})`} />
                )}
                <text x={pos.x} y={pos.y+1} textAnchor="middle" dominantBaseline="central"
                  fill="white" fontSize={r > 24 ? 11 : 9} fontWeight={600}>{goal.progress}%</text>
                <text x={pos.x} y={pos.y+r+14} textAnchor="middle" fill="currentColor"
                  className="text-foreground/70" fontSize={11}>
                  {goal.title.length > 20 ? goal.title.slice(0,18)+'...' : goal.title}
                </text>
                {isHovered && (
                  <foreignObject x={pos.x-100} y={pos.y-r-50} width={200} height={40}>
                    <div className="bg-background/95 border border-primary/20 rounded-interactive px-3 py-1.5 text-center shadow-lg">
                      <p className="typo-body text-foreground truncate">{goal.title}</p>
                      <p className="typo-caption text-foreground">{goal.status} · {goal.progress}%</p>
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-4 typo-caption text-foreground/60">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.fill }} />
            {status}
          </div>
        ))}
        <span className="mx-2">|</span>
        <span>━━ parent</span>
        <span>┄┄ dependency</span>
      </div>
    </div>
  );
}
