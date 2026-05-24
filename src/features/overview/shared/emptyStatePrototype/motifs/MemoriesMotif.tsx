import { motion } from 'framer-motion';
import type { MotifProps } from '../types';

/**
 * Memories motif — a memory core gathering fragments. A central rounded core
 * pulses on, then crystalline memory shards converge toward it along synapse
 * lines: the notes & learnings agents store as they run. Entry-only.
 *
 * Deliberately distinct from {@link KnowledgeMotif} (a flat network): this is a
 * single core with radiating fragments, not a peer-to-peer graph.
 */
export function MemoriesMotif({ accent, size = 168 }: MotifProps) {
  const stroke = accent.stroke;
  const shards = [
    { x: 34, y: 44, s: 11, delay: 0.45 },
    { x: 132, y: 40, s: 9, delay: 0.58 },
    { x: 138, y: 104, s: 12, delay: 0.71 },
    { x: 36, y: 116, s: 9, delay: 0.84 },
  ];
  const cx = 84;
  const cy = 84;
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden="true">
      {/* synapse lines core → shards */}
      {shards.map((s, i) => (
        <motion.line
          key={`l${i}`}
          x1={cx} y1={cy} x2={s.x} y2={s.y}
          stroke={stroke} strokeOpacity={0.22} strokeWidth={1.5} strokeDasharray="2 4"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ delay: 0.25 + i * 0.08, duration: 0.45, ease: 'easeInOut' }}
        />
      ))}
      {/* core */}
      <motion.g
        initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 16 }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      >
        <circle cx={cx} cy={cy} r={26} fill={stroke} fillOpacity={0.08} />
        <rect x={cx - 15} y={cy - 15} width={30} height={30} rx={9} transform={`rotate(45 ${cx} ${cy})`} fill={stroke} fillOpacity={0.18} stroke={stroke} strokeOpacity={0.6} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={5} fill={stroke} fillOpacity={0.9} />
      </motion.g>
      {/* converging shards (diamonds) */}
      {shards.map((s, i) => (
        <motion.g
          key={`s${i}`}
          initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: s.delay, type: 'spring', stiffness: 300, damping: 18 }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          <rect x={s.x - s.s / 2} y={s.y - s.s / 2} width={s.s} height={s.s} rx={2} transform={`rotate(45 ${s.x} ${s.y})`} fill={stroke} fillOpacity={0.5} stroke={stroke} strokeOpacity={0.6} strokeWidth={1.5} />
        </motion.g>
      ))}
    </svg>
  );
}
