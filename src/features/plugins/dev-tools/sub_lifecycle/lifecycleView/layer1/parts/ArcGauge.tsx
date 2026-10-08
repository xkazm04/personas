/**
 * A drawn rate around (or under) a step: a ring (`shape="ring"`) or a top
 * semicircle (`shape="arc"`), feature-local because nothing in the kit draws a
 * radial quantity. The drawing is `aria-hidden`; the figure beside it is what a
 * reader hears.
 *
 * - a known rate draws its share of the track in the verdict's ink;
 * - a measured verdict with no rate (a gate known only by its time) draws the
 *   whole track faintly in that ink, so the ring still says green/amber/red;
 * - `unmeasured` draws a DASHED empty track and nothing else: no share, no
 *   fill, so it can never be read as a low green;
 * - `instructed` draws a hairline only;
 * - `stale` draws a dotted track, its share, and a hatched disc.
 *
 * Motion: the share draws in once on mount (skipped under reduced motion).
 */
import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import { VERDICT } from '../healthModel';

interface ArcGaugeProps {
  health: LifecycleHealth;
  ratio: number | null;
  /** Outer size in px. */
  size: number;
  stroke?: number;
  shape?: 'ring' | 'arc';
  children?: ReactNode;
}

export function ArcGauge({ health, ratio, size, stroke = 6, shape = 'ring', children }: ArcGaugeProps) {
  const reduced = useReducedMotion();
  const hatchId = useId();
  const v = VERDICT[health];
  const r = (size - stroke) / 2 - 1;
  const c = size / 2;
  const height = shape === 'arc' ? c + stroke : size;
  // A ring starts at 12 o'clock and runs clockwise; an arc runs left to right over the top.
  const path = shape === 'arc'
    ? `M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`
    : `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r}`;
  const track = health === 'instructed' ? 1.5 : stroke;
  // Dashes use butt caps: a round cap on a thick stroke closes the gaps and a
  // dashed ring would read as a solid grey one.
  const dash = v.hollow ? '6 7' : health === 'stale' ? '2 6' : undefined;
  const measured = health === 'green' || health === 'amber' || health === 'red' || health === 'stale';
  const share = measured ? ratio : null;

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height }}>
      <svg aria-hidden width={size} height={height} viewBox={`0 0 ${size} ${height}`} className="absolute inset-0 overflow-visible">
        {v.hatched && (
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" className="text-status-info/30" />
            </pattern>
          </defs>
        )}
        {v.hatched && shape === 'ring' && <circle cx={c} cy={c} r={r - stroke} fill={`url(#${hatchId})`} />}
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={track}
          strokeLinecap={dash ? 'butt' : 'round'}
          strokeDasharray={dash}
          className={v.hollow ? 'stroke-foreground/40' : measured && share == null ? `${v.ink} opacity-35` : 'text-primary/15'}
        />
        {share != null && share > 0 && (
          <motion.path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            className={v.ink}
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: share }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </svg>
      {children}
    </span>
  );
}
