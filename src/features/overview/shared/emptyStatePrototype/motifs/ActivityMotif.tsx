import { motion } from 'framer-motion';
import type { MotifProps } from '../types';

/**
 * Activity motif — an execution timeline. A waveform "draws" left-to-right
 * (pathLength) as if a run were being recorded, with pulse nodes settling onto
 * the baseline. Entry-only: it plays once on mount, then rests flat.
 */
export function ActivityMotif({ accent, size = 168 }: MotifProps) {
  const stroke = accent.stroke;
  const nodes = [
    { x: 30, y: 78 },
    { x: 66, y: 52 },
    { x: 102, y: 88 },
    { x: 138, y: 44 },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden="true">
      {/* baseline track */}
      <line x1="14" y1="120" x2="154" y2="120" stroke={stroke} strokeOpacity={0.18} strokeWidth={2} strokeLinecap="round" />
      {/* dashed "future" segment past the recorded waveform */}
      <line x1="14" y1="78" x2="154" y2="78" stroke={stroke} strokeOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 6" />
      {/* recorded waveform */}
      <motion.path
        d="M14 78 L30 78 L48 40 L66 96 L84 62 L102 100 L120 48 L138 84 L154 78"
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0.2 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: 'easeInOut' }}
      />
      {/* pulse nodes dropping onto the baseline */}
      {nodes.map((n, i) => (
        <motion.g
          key={i}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 + i * 0.12, type: 'spring', stiffness: 320, damping: 22 }}
        >
          <circle cx={n.x} cy={120} r={4} fill={stroke} />
          <line x1={n.x} y1={n.y + 6} x2={n.x} y2={116} stroke={stroke} strokeOpacity={0.3} strokeWidth={1.5} />
        </motion.g>
      ))}
    </svg>
  );
}
