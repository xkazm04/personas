import { motion } from 'framer-motion';
import type { MotifProps } from '../types';

/**
 * Knowledge motif — a knowledge graph assembling itself. Edges draw in
 * (pathLength) then nodes scale on, the way auto-extracted patterns would link
 * up over successive runs. Entry-only.
 */
export function KnowledgeMotif({ accent, size = 168 }: MotifProps) {
  const stroke = accent.stroke;
  const nodes = [
    { x: 84, y: 84, r: 9 }, // hub
    { x: 40, y: 50, r: 6 },
    { x: 128, y: 46, r: 6 },
    { x: 132, y: 110, r: 6 },
    { x: 44, y: 120, r: 6 },
    { x: 100, y: 30, r: 4 },
  ];
  const edges = [
    [0, 1], [0, 2], [0, 3], [0, 4], [2, 5], [1, 4],
  ] as const;
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden="true">
      {edges.map(([a, b], i) => (
        <motion.line
          key={i}
          x1={nodes[a]!.x} y1={nodes[a]!.y} x2={nodes[b]!.x} y2={nodes[b]!.y}
          stroke={stroke} strokeOpacity={0.3} strokeWidth={1.5}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ delay: 0.1 + i * 0.08, duration: 0.5, ease: 'easeInOut' }}
        />
      ))}
      {nodes.map((n, i) => (
        <motion.g
          key={i}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.5 + i * 0.09, type: 'spring', stiffness: 320, damping: 18 }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          <circle cx={n.x} cy={n.y} r={n.r + 4} fill={stroke} fillOpacity={0.1} />
          <circle cx={n.x} cy={n.y} r={n.r} fill={stroke} fillOpacity={i === 0 ? 0.9 : 0.55} stroke={stroke} strokeOpacity={0.6} strokeWidth={1.5} />
        </motion.g>
      ))}
    </svg>
  );
}
