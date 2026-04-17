import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Target, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';
import * as devApi from '@/api/devTools/devTools';

// ---------------------------------------------------------------------------
// Force-directed layout (pure JS, no D3)
// ---------------------------------------------------------------------------

interface NodePos {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

function runForceSimulation(
  nodes: NodePos[],
  edges: { source: string; target: string }[],
  width: number,
  height: number,
  iterations: number = 120,
) {
  const cx = width / 2;
  const cy = height / 2;

  // Initialize positions in a circle
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = Math.min(width, height) * 0.3;
    n.x = cx + Math.cos(angle) * r;
    n.y = cy + Math.sin(angle) * r;
    n.vx = 0;
    n.vy = 0;
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const decay = 0.3 * alpha;

    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (300 * decay) / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx -= dx;
        a.vy -= dy;
        b.vx += dx;
        b.vy += dy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - 120) * 0.01 * decay;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
    }

    // Center gravity
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.005 * decay;
      n.vy += (cy - n.y) * 0.005 * decay;
    }

    // Apply velocity with damping
    for (const n of nodes) {
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
      // Clamp to bounds
      n.x = Math.max(n.radius + 10, Math.min(width - n.radius - 10, n.x));
      n.y = Math.max(n.radius + 10, Math.min(height - n.radius - 10, n.y));
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Status colors and sizing
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { fill: string; stroke: string; glow: string }> = {
  open: { fill: '#3B82F6', stroke: '#60A5FA', glow: 'rgba(59, 130, 246, 0.3)' },
  'in-progress': { fill: '#F59E0B', stroke: '#FBBF24', glow: 'rgba(245, 158, 11, 0.4)' },
  done: { fill: '#10B981', stroke: '#34D399', glow: 'rgba(16, 185, 129, 0.3)' },
  blocked: { fill: '#EF4444', stroke: '#F87171', glow: 'rgba(239, 68, 68, 0.4)' },
};

function nodeRadius(goal: DevGoal): number {
  return 18 + (goal.progress / 100) * 14;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GoalConstellation() {
  const { t } = useTranslation();
  const goals = useSystemStore((s) => s.goals);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);

  const [dependencies, setDependencies] = useState<DevGoalDependency[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const WIDTH = 800;
  const HEIGHT = 500;

  useEffect(() => {
    if (activeProjectId) fetchGoals(activeProjectId);
  }, [activeProjectId, fetchGoals]);

  // Fetch all dependencies
  useEffect(() => {
    async function loadDeps() {
      const allDeps: DevGoalDependency[] = [];
      for (const g of goals) {
        try {
          const deps = await devApi.listGoalDependencies(g.id);
          allDeps.push(...deps);
        } catch { /* ignore */ }
      }
      setDependencies(allDeps);
    }
    if (goals.length > 0) loadDeps();
  }, [goals]);

  // Build edges from parent_goal_id + dependencies
  const edges = useMemo(() => {
    const result: { source: string; target: string; type: string }[] = [];

    // Parent-child edges
    for (const g of goals) {
      if (g.parent_goal_id) {
        result.push({ source: g.parent_goal_id, target: g.id, type: 'parent' });
      }
    }

    // Dependency edges
    for (const d of dependencies) {
      result.push({ source: d.depends_on_id, target: d.goal_id, type: d.dependency_type });
    }

    return result;
  }, [goals, dependencies]);

  // Run force simulation
  const positions = useMemo(() => {
    if (goals.length === 0) return [];
    const nodes: NodePos[] = goals.map((g) => ({
      id: g.id,
      x: 0, y: 0, vx: 0, vy: 0,
      radius: nodeRadius(g),
    }));
    return runForceSimulation(
      nodes,
      edges.map((e) => ({ source: e.source, target: e.target })),
      WIDTH,
      HEIGHT,
    );
  }, [goals, edges]);

  const posMap = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, 2)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, 0.4)), []);
  const handleReset = useCallback(() => setZoom(1), []);

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Target className="w-10 h-10 text-foreground mb-3" />
        <p className="text-md text-foreground">{t.plugins.dev_tools.no_goals_constellation}</p>
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
        <span className="text-md text-foreground ml-2">{goals.length} {t.plugins.dev_tools.goals_label} {edges.length} {t.plugins.dev_tools.connections_label}</span>
      </div>

      {/* SVG Canvas */}
      <div className="rounded-modal border border-primary/10 bg-background/50 overflow-hidden" style={{ height: HEIGHT * zoom }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height="100%"
          className="select-none"
        >
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" className="text-foreground" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((edge, i) => {
            const s = posMap.get(edge.source);
            const t = posMap.get(edge.target);
            if (!s || !t) return null;
            const isParent = edge.type === 'parent';
            return (
              <line
                key={`edge-${i}`}
                x1={s.x} y1={s.y}
                x2={t.x} y2={t.y}
                stroke={isParent ? 'rgba(139, 92, 246, 0.3)' : 'rgba(245, 158, 11, 0.25)'}
                strokeWidth={isParent ? 2 : 1.5}
                strokeDasharray={isParent ? undefined : '4 3'}
                markerEnd="url(#arrowhead)"
              />
            );
          })}

          {/* Nodes */}
          {goals.map((goal) => {
            const pos = posMap.get(goal.id);
            if (!pos) return null;
            const colors = (STATUS_COLORS[goal.status] ?? STATUS_COLORS.open)!;
            const isHovered = hoveredId === goal.id;
            const r = pos.radius;
            const isStalled = goal.status === 'blocked' || (goal.status === 'in-progress' && goal.progress < 10);

            return (
              <g
                key={goal.id}
                onMouseEnter={() => setHoveredId(goal.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="cursor-pointer"
              >
                {/* Glow / pulse for stalled */}
                {isStalled && (
                  <circle cx={pos.x} cy={pos.y} r={r + 6} fill="none" stroke={colors.stroke} strokeWidth={1} opacity={0.4}>
                    <animate attributeName="r" values={`${r + 4};${r + 10};${r + 4}`} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Main circle */}
                <circle
                  cx={pos.x} cy={pos.y} r={r}
                  fill={colors.fill}
                  stroke={isHovered ? '#fff' : colors.stroke}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  opacity={isHovered ? 1 : 0.85}
                  style={{ filter: isHovered ? `drop-shadow(0 0 8px ${colors.glow})` : undefined }}
                />

                {/* Progress arc */}
                {goal.progress > 0 && goal.progress < 100 && (
                  <circle
                    cx={pos.x} cy={pos.y} r={r - 3}
                    fill="none"
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth={2}
                    strokeDasharray={`${(goal.progress / 100) * (2 * Math.PI * (r - 3))} ${2 * Math.PI * (r - 3)}`}
                    transform={`rotate(-90 ${pos.x} ${pos.y})`}
                  />
                )}

                {/* Progress text */}
                <text
                  x={pos.x} y={pos.y + 1}
                  textAnchor="middle" dominantBaseline="central"
                  fill="white" fontSize={r > 24 ? 11 : 9} fontWeight={600}
                >
                  {goal.progress}%
                </text>

                {/* Label below */}
                <text
                  x={pos.x} y={pos.y + r + 14}
                  textAnchor="middle"
                  fill="currentColor"
                  className="text-foreground"
                  fontSize={11}
                >
                  {goal.title.length > 20 ? goal.title.slice(0, 18) + '...' : goal.title}
                </text>

                {/* Hover tooltip */}
                {isHovered && (
                  <foreignObject x={pos.x - 100} y={pos.y - r - 50} width={200} height={40}>
                    <div className="bg-background/95 border border-primary/20 rounded-card px-3 py-1.5 text-center shadow-elevation-3">
                      <p className="text-md font-medium text-foreground truncate">{goal.title}</p>
                      <p className="text-md text-foreground">{goal.status} &middot; {goal.progress}%</p>
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-md text-foreground">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.fill }} />
            {status}
          </div>
        ))}
        <span className="mx-2">|</span>
        <span>{t.plugins.dev_tools.legend_parent}</span>
        <span>{t.plugins.dev_tools.legend_dependency}</span>
      </div>
    </div>
  );
}
