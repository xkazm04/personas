import { ROLE_COLORS } from '../../sub_canvas/libs/teamConstants';
import type { PipelineTemplate } from './pipelineTemplateTypes';
import { EDGE_COLORS, NODE_ROLE_FILLS } from './pipelineTemplateTypes';

// ============================================================================
// Mini Canvas SVG — renders topology shape
// ============================================================================

export function MiniCanvas({ template, hovered }: { template: PipelineTemplate; hovered: boolean }) {
  const w = 160;
  const h = 80;
  const r = hovered ? 7 : 6;

  const nodeMap = new Map(template.nodes.map((n) => [n.id, n]));

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      {/* Edges */}
      {template.edges.map((edge, i) => {
        const src = nodeMap.get(edge.source);
        const tgt = nodeMap.get(edge.target);
        if (!src || !tgt) return null;
        const sx = (src.x / 100) * w;
        const sy = (src.y / 100) * h;
        const tx = (tgt.x / 100) * w;
        const ty = (tgt.y / 100) * h;
        const color = EDGE_COLORS[edge.type] || '#3b82f6';
        const dashArray = edge.type === 'feedback' ? '3 3' : edge.type === 'conditional' ? '4 2' : undefined;

        // Curved path for feedback edges
        if (edge.type === 'feedback') {
          const midX = (sx + tx) / 2;
          const midY = Math.min(sy, ty) - 14;
          return (
            <path
              key={i}
              d={`M ${sx} ${sy} Q ${midX} ${midY} ${tx} ${ty}`}
              fill="none"
              stroke={color}
              strokeWidth={1}
              strokeDasharray={dashArray}
              opacity={hovered ? 0.7 : 0.4}
              className="transition-opacity duration-200"
            />
          );
        }

        return (
          <line
            key={i}
            x1={sx} y1={sy}
            x2={tx} y2={ty}
            stroke={color}
            strokeWidth={1.2}
            strokeDasharray={dashArray}
            opacity={hovered ? 0.6 : 0.35}
            className="transition-opacity duration-200"
          />
        );
      })}
      {/* Nodes */}
      {template.nodes.map((node) => {
        const cx = (node.x / 100) * w;
        const cy = (node.y / 100) * h;
        const fill = NODE_ROLE_FILLS[node.role] || '#6366f1';
        return (
          <g key={node.id}>
            <circle
              cx={cx} cy={cy} r={r}
              fill={fill}
              opacity={hovered ? 0.85 : 0.55}
              className="transition-all duration-200"
            />
            <circle
              cx={cx} cy={cy} r={r + 3}
              fill="none"
              stroke={fill}
              strokeWidth={1}
              opacity={hovered ? 0.25 : 0}
              className="transition-opacity duration-200"
            />
          </g>
        );
      })}
    </svg>
  );
}

// ============================================================================
// Role Legend (shown in expanded details)
// ============================================================================

export function RoleBadge({ role }: { role: string }) {
  const colors = ROLE_COLORS[role] || { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/25' };
  return (
    <span className={`inline-flex px-1.5 py-0.5 text-sm font-mono rounded-lg ${colors.bg} ${colors.text} ${colors.border} border`}>
      {role}
    </span>
  );
}
