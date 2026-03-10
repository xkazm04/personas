import { motion } from 'framer-motion';
import { CX, CY, iconChar } from '../../libs/visualizationHelpers';
import type { ProcessingInfo } from '../../libs/visualizationHelpers';
import { NODE_R } from './EventBusTypes';

interface RingNode {
  id: string;
  label: string;
  icon: string | null;
  color: string;
  x: number;
  y: number;
  sizeFactor?: number;
}

export function OuterNodeGroup({ nodes }: { nodes: RingNode[] }) {
  return (
    <>
      {nodes.map(node => {
        const sf = node.sizeFactor ?? 1;
        const isDisc = !node.id.startsWith('def:');
        const r = isDisc ? 2.2 + sf * 1.6 : NODE_R;
        const opacity = isDisc ? 0.5 + sf * 0.5 : 0.35;
        return (
          <g key={node.id} opacity={opacity}>
            <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke={node.color} strokeWidth="0.06" opacity={0.15} />
            <polygon
              points={`${node.x},${node.y - r} ${node.x + r * 0.7},${node.y} ${node.x},${node.y + r} ${node.x - r * 0.7},${node.y}`}
              fill={`${node.color}20`} stroke={node.color} strokeWidth={isDisc ? 0.25 : 0.15}
            />
            <circle cx={node.x} cy={node.y} r={r * 0.3} fill={node.color} opacity={0.6} />
            <text x={node.x} y={node.y + r + 2} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="1.3" fontFamily="monospace">
              {node.label}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function InnerNodeGroup({
  nodes,
  processingSet,
  hasTraffic,
}: {
  nodes: RingNode[];
  processingSet: Map<string, ProcessingInfo>;
  hasTraffic: boolean;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        const r = 3.5;
        const proc = processingSet.get(node.id);
        const hex = Array.from({ length: 6 }, (_, j) => {
          const a = (j * 60 - 30) * (Math.PI / 180);
          return `${node.x + r * Math.cos(a)},${node.y + r * Math.sin(a)}`;
        }).join(' ');
        return (
          <g key={node.id}>
            <line x1={node.x} y1={node.y} x2={CX} y2={CY} stroke={node.color} strokeWidth="0.06" opacity={0.08} />
            <circle cx={node.x} cy={node.y} r={r + 1.5} fill="none" stroke={node.color} strokeWidth="0.08" opacity={hasTraffic ? 0.12 : 0.04}>
              <animate attributeName="r" values={`${r + 0.8};${r + 2};${r + 0.8}`} dur={`${3.5 + i % 3}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values={`${hasTraffic ? 0.12 : 0.04};0.02;${hasTraffic ? 0.12 : 0.04}`} dur={`${3.5 + i % 3}s`} repeatCount="indefinite" />
            </circle>
            <polygon points={hex} fill={`${node.color}18`} stroke={node.color} strokeWidth="0.25" />
            <circle cx={node.x} cy={node.y} r={r * 0.4} fill={node.color} opacity={0.5} />
            <text x={node.x} y={node.y + 0.5} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.85)" fontSize="2.6" fontFamily="monospace">
              {iconChar(node)}
            </text>
            <text x={node.x} y={node.y + r + 2.2} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="1.4" fontFamily="monospace" fontWeight="500">
              {node.label}
            </text>
            {proc && (
              <g>
                <circle cx={node.x} cy={node.y} r={r + 1.2} fill="none" stroke={`${proc.color}25`} strokeWidth="0.4" />
                <motion.circle
                  cx={node.x} cy={node.y} r={r + 1.2}
                  fill="none" stroke={proc.color} strokeWidth="0.5" strokeLinecap="round"
                  style={{ strokeDasharray: 2 * Math.PI * (r + 1.2), transformOrigin: `${node.x}px ${node.y}px`, transform: 'rotate(-90deg)' }}
                  initial={{ strokeDashoffset: 2 * Math.PI * (r + 1.2) }}
                  animate={{ strokeDashoffset: 0 }}
                  transition={{ duration: proc.durationMs / 1000, ease: 'linear' }}
                />
              </g>
            )}
          </g>
        );
      })}
    </>
  );
}
