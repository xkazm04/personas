import { motion } from 'framer-motion';
import type { MotifProps } from '../types';

/**
 * Approval motif — a review tray that clears. Three queued cards settle into a
 * neat stack and a checkmark badge draws itself in: "all caught up, nothing
 * waiting on you". Entry-only.
 */
export function ApprovalMotif({ accent, size = 168 }: MotifProps) {
  const stroke = accent.stroke;
  const cards = [
    { y: 96, w: 96, x: 36, delay: 0.15 },
    { y: 74, w: 84, x: 42, delay: 0.28 },
    { y: 52, w: 72, x: 48, delay: 0.41 },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden="true">
      {/* tray lip */}
      <path d="M28 120 H140 M28 120 V112 M140 120 V112" stroke={stroke} strokeOpacity={0.22} strokeWidth={2} strokeLinecap="round" />
      {/* settled review cards */}
      {cards.map((c, i) => (
        <motion.g
          key={i}
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: c.delay, type: 'spring', stiffness: 260, damping: 20 }}
        >
          <rect x={c.x} y={c.y} width={c.w} height={16} rx={5} fill={stroke} fillOpacity={0.08} stroke={stroke} strokeOpacity={0.28} strokeWidth={1.5} />
          <line x1={c.x + 10} y1={c.y + 8} x2={c.x + c.w * 0.55} y2={c.y + 8} stroke={stroke} strokeOpacity={0.4} strokeWidth={2} strokeLinecap="round" />
        </motion.g>
      ))}
      {/* clear / caught-up checkmark badge */}
      <motion.g initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.62, type: 'spring', stiffness: 300, damping: 18 }}>
        <circle cx={120} cy={44} r={18} fill={stroke} fillOpacity={0.12} stroke={stroke} strokeOpacity={0.5} strokeWidth={2} />
        <motion.path
          d="M111 44 l6 6 l11 -13"
          stroke={stroke}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.82, duration: 0.4, ease: 'easeOut' }}
        />
      </motion.g>
    </svg>
  );
}
