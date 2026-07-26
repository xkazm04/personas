import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

/**
 * @catalog Reveal — fade (+ subtle slide-up) a block of content in on mount; the canonical "content arrived" reveal for the golden loading pattern, reduced-motion aware.
 *
 * Use it wherever content becomes ready and should appear calmly rather than
 * snap in — a KPI row, a chart, a panel, a section that just resolved. Bump
 * `delay` on siblings to stagger a group (or wrap them in a
 * `staggerContainer` parent). Replaces ad-hoc `motion.div variants={fadeUp}`.
 *
 * Reduced-motion: collapses to an instant, transform-free appearance (opacity
 * settles immediately, no travel, no delay) via `useMotion()`.
 */
export interface RevealProps {
  children: ReactNode;
  /** Extra delay (seconds) before revealing — stagger siblings by bumping this. */
  delay?: number;
  /** Vertical travel in px (default 8). Set `0` for a pure fade. */
  y?: number;
  className?: string;
}

export function Reveal({ children, delay = 0, y = 8, className }: RevealProps) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.div
      className={className}
      initial={shouldAnimate ? { opacity: 0, y } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldAnimate ? 0.24 : 0,
        ease: [0.22, 1, 0.36, 1],
        delay: shouldAnimate ? delay : 0,
      }}
    >
      {children}
    </motion.div>
  );
}
