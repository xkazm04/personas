import { motion } from 'framer-motion';
import type { MotifProps } from '../types';

/**
 * Messages motif — a conversation thread forming. Speech bubbles slide in from
 * alternating sides along a vertical thread line, the way persona messages
 * would stack once agents start talking. Entry-only.
 */
export function MessagesMotif({ accent, size = 168 }: MotifProps) {
  const stroke = accent.stroke;
  const bubbles = [
    { x: 30, y: 40, w: 70, side: -1, delay: 0.15 },
    { x: 68, y: 78, w: 70, side: 1, delay: 0.32 },
    { x: 36, y: 116, w: 58, side: -1, delay: 0.49 },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden="true">
      {/* thread spine */}
      <motion.line
        x1="84" y1="34" x2="84" y2="134"
        stroke={stroke} strokeOpacity={0.18} strokeWidth={2} strokeDasharray="3 5"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: 'easeInOut' }}
      />
      {bubbles.map((b, i) => (
        <motion.g
          key={i}
          initial={{ x: b.side * 18, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: b.delay, type: 'spring', stiffness: 280, damping: 22 }}
        >
          <rect x={b.x} y={b.y} width={b.w} height={26} rx={9} fill={stroke} fillOpacity={0.1} stroke={stroke} strokeOpacity={0.32} strokeWidth={1.5} />
          {/* tail */}
          <path
            d={b.side < 0 ? `M${b.x + 8} ${b.y + 26} l-6 7 l10 -2 z` : `M${b.x + b.w - 8} ${b.y + 26} l6 7 l-10 -2 z`}
            fill={stroke} fillOpacity={0.1} stroke={stroke} strokeOpacity={0.32} strokeWidth={1.5} strokeLinejoin="round"
          />
          <line x1={b.x + 10} y1={b.y + 10} x2={b.x + b.w - 12} y2={b.y + 10} stroke={stroke} strokeOpacity={0.42} strokeWidth={2} strokeLinecap="round" />
          <line x1={b.x + 10} y1={b.y + 17} x2={b.x + b.w * 0.6} y2={b.y + 17} stroke={stroke} strokeOpacity={0.3} strokeWidth={2} strokeLinecap="round" />
        </motion.g>
      ))}
    </svg>
  );
}
