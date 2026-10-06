/**
 * IslandMark - Athena's mark on the island: her real portrait (the poster
 * frame every avatar clip starts from), cropped to the face, inside a ring
 * that is the island's one live signal. The ring lights while she works and
 * sweeps only then (gated on reduced motion); a human-colour notch on its
 * shoulder says something is blocked on you. Static otherwise: a capsule that
 * moves while nothing happens is noise.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

export function IslandMark({
  working,
  gated,
  large = false,
}: {
  working: boolean;
  gated: boolean;
  large?: boolean;
}) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.span
      layoutId="r5a-mark"
      transition={{ duration: shouldAnimate ? 0.4 : 0, ease: [0.22, 1, 0.36, 1] }}
      className={`r5a-mark${large ? ' is-lg' : ''}${working ? ' is-live' : ''}${working && shouldAnimate ? ' is-moving' : ''}`}
      aria-hidden
    >
      <span className="r5a-ring" />
      <span className="r5a-face" />
      {gated && <span className="r5a-notch" />}
    </motion.span>
  );
}
