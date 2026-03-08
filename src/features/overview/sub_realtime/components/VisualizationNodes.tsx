import { motion } from 'framer-motion';
import type { SwarmNode, ProcessingInfo } from '../libs/visualizationHelpers';
import {
  TOOL_NODE_R_MIN, TOOL_NODE_R_MAX, TOOL_NODE_R,
  PERSONA_NODE_R, PROGRESS_R, PROGRESS_CIRC,
  CX, CY, iconChar, clampLabel,
} from '../libs/visualizationHelpers';

export function ToolNodeGroup({ nodes }: { nodes: SwarmNode[] }) {
  return (
    <>
      {nodes.map((node) => {
        const sf = node.sizeFactor ?? 1;
        const isDiscovered = !node.id.startsWith('def:');
        const nodeR = isDiscovered
          ? TOOL_NODE_R_MIN + sf * (TOOL_NODE_R_MAX - TOOL_NODE_R_MIN)
          : TOOL_NODE_R;
        const nodeOpacity = isDiscovered ? 0.4 + sf * 0.5 : 0.45;
        const lineWidth = isDiscovered ? 0.1 + sf * 0.25 : 0.15;
        return (
          <g key={node.id} opacity={nodeOpacity}>
            <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke={isDiscovered ? `${node.color}15` : 'rgba(255,255,255,0.03)'} strokeWidth={lineWidth} strokeDasharray="0.8 1.5" />
            <circle cx={node.x} cy={node.y} r={nodeR} fill={`${node.color}18`} stroke={node.color} strokeWidth={isDiscovered ? 0.3 : 0.2} />
            <text x={node.x} y={node.y + 0.5} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.7)" fontSize={isDiscovered ? Math.max(1.8, 2.4 * sf) : 2.4} fontFamily="monospace">
              {iconChar(node)}
            </text>
            <text x={node.x} y={node.y + nodeR + 2.2} textAnchor="middle" fill={isDiscovered ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)'} fontSize="1.5" fontFamily="monospace">
              {clampLabel(node.label, 9)}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function PersonaNodeGroup({
  nodes,
  processingSet,
}: {
  nodes: SwarmNode[];
  processingSet: Map<string, ProcessingInfo>;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        const proc = processingSet.get(node.id);
        return (
          <g key={node.id}>
            <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke={`${node.color}0a`} strokeWidth="0.2" strokeDasharray="1 2" />
            <circle cx={node.x} cy={node.y} r={PERSONA_NODE_R + 0.5} fill="none" stroke={node.color} strokeWidth="0.1" opacity={0.1}>
              <animate attributeName="r" values={`${PERSONA_NODE_R + 0.3};${PERSONA_NODE_R + 1};${PERSONA_NODE_R + 0.3}`} dur={`${4 + (i % 2)}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.1;0.02;0.1" dur={`${4 + (i % 2)}s`} repeatCount="indefinite" />
            </circle>
            <circle cx={node.x} cy={node.y} r={PERSONA_NODE_R} fill={`${node.color}15`} stroke={node.color} strokeWidth="0.3" opacity={0.9} />
            <circle cx={node.x} cy={node.y} r={PERSONA_NODE_R * 0.5} fill={node.color} opacity={0.55} />
            <text x={node.x} y={node.y + 0.5} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.85)" fontSize={node.icon && node.icon.length <= 2 ? '3' : '2.6'} fontFamily="monospace">
              {iconChar(node)}
            </text>
            <text x={node.x} y={node.y + PERSONA_NODE_R + 2.4} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="1.5" fontFamily="monospace" fontWeight="500">
              {clampLabel(node.label, 10)}
            </text>
            {proc && (
              <g>
                <circle cx={node.x} cy={node.y} r={PROGRESS_R} fill="none" stroke={`${proc.color}20`} strokeWidth="0.5" />
                <motion.circle
                  cx={node.x} cy={node.y} r={PROGRESS_R}
                  fill="none" stroke={proc.color} strokeWidth="0.5" strokeLinecap="round"
                  style={{ strokeDasharray: PROGRESS_CIRC, transformOrigin: `${node.x}px ${node.y}px`, transform: `rotate(-90deg)` }}
                  initial={{ strokeDashoffset: PROGRESS_CIRC }}
                  animate={{ strokeDashoffset: 0 }}
                  transition={{ duration: proc.durationMs / 1000, ease: 'linear' }}
                />
                <circle cx={node.x} cy={node.y} r={PERSONA_NODE_R + 0.5} fill="none" stroke={proc.color} strokeWidth="0.15" opacity={0.35}>
                  <animate attributeName="opacity" values="0.35;0.1;0.35" dur="0.7s" repeatCount="indefinite" />
                </circle>
              </g>
            )}
          </g>
        );
      })}
    </>
  );
}
