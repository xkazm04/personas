import { motion } from 'framer-motion';
import type { MotifProps } from '../types';

/**
 * Leaderboard motif — a podium rising. Three ranked bars grow from the baseline
 * (scaleY, staggered shortest→tallest) and a crown/star settles on the winner:
 * the ranking that appears once agents have run enough to be scored. Entry-only.
 */
export function LeaderboardMotif({ accent, size = 168 }: MotifProps) {
  const stroke = accent.stroke;
  // x, width, top-y of each podium block (baseline at y=126)
  const bars = [
    { x: 34, w: 32, top: 86, delay: 0.15 }, // 2nd
    { x: 70, w: 32, top: 54, delay: 0.32 }, // 1st (tallest)
    { x: 106, w: 32, top: 100, delay: 0.49 }, // 3rd
  ];
  const baseline = 126;
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden="true">
      <line x1="22" y1={baseline} x2="146" y2={baseline} stroke={stroke} strokeOpacity={0.2} strokeWidth={2} strokeLinecap="round" />
      {bars.map((b, i) => (
        <motion.rect
          key={i}
          x={b.x} y={b.top} width={b.w} height={baseline - b.top} rx={4}
          fill={stroke} fillOpacity={i === 1 ? 0.22 : 0.1} stroke={stroke} strokeOpacity={i === 1 ? 0.6 : 0.35} strokeWidth={1.5}
          initial={{ scaleY: 0, opacity: 0.3 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ delay: b.delay, type: 'spring', stiffness: 220, damping: 20 }}
          style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
        />
      ))}
      {/* winner star on tallest bar */}
      <motion.path
        d="M86 30 l3.2 6.6 l7.2 1 l-5.2 5.1 l1.2 7.2 l-6.4 -3.4 l-6.4 3.4 l1.2 -7.2 l-5.2 -5.1 l7.2 -1 z"
        fill={stroke} fillOpacity={0.85} stroke={stroke} strokeOpacity={0.7} strokeWidth={1.2} strokeLinejoin="round"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.66, type: 'spring', stiffness: 320, damping: 16 }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
    </svg>
  );
}
