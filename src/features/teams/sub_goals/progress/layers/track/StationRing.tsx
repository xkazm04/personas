/**
 * The station's FIGURE: a big ring whose border fills clockwise with the
 * milestone's progress. The colour arrives as a text class (the tone's
 * `.text`) and the SVG paints with `currentColor`, so the ring wears exactly the
 * colour `milestoneMeta` gives the milestone everywhere else - no second map.
 *
 * `progress === null` means no goal is bound: the ring is drawn DASHED and
 * empty, and the centre says so in words. A 0% ring would claim a measurement
 * nobody took.
 */
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export const RING_PX = 88;
const VIEW = 88;
const STROKE = 7;
const R = (VIEW - STROKE) / 2 - 1;
const C = VIEW / 2;

export function StationRing({
  progress,
  toneText,
  dashed = false,
  label,
  children,
}: {
  /** 0-100, or `null` for "nothing measured". */
  progress: number | null;
  /** A text-colour class; the ring paints with `currentColor`. */
  toneText: string;
  /** Force the dashed outline (the Unassigned and Add stations). */
  dashed?: boolean;
  /** The ring's accessible name. */
  label: string;
  /** The centre: a figure, a word or an icon. */
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const empty = dashed || progress === null;
  const pct = progress ?? 0;

  return (
    <span
      role="img"
      aria-label={label}
      className={`relative inline-flex items-center justify-center shrink-0 ${toneText}`}
      style={{ width: RING_PX, height: RING_PX }}
    >
      <svg width={RING_PX} height={RING_PX} viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" className="absolute inset-0">
        {empty ? (
          <circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.45}
            strokeWidth={2}
            pathLength={100}
            strokeDasharray="2.2 2.8"
          />
        ) : (
          <>
            <circle cx={C} cy={C} r={R} fill="currentColor" fillOpacity={0.06} stroke="currentColor" strokeOpacity={0.16} strokeWidth={STROKE} />
            <motion.circle
              cx={C}
              cy={C}
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE}
              strokeLinecap={pct > 0 ? 'round' : 'butt'}
              pathLength={100}
              transform={`rotate(-90 ${C} ${C})`}
              initial={reduce ? false : { strokeDasharray: '0 100' }}
              animate={{ strokeDasharray: `${pct} 100` }}
              transition={reduce ? { duration: 0 } : { duration: 0.7, ease: 'easeOut' }}
            />
          </>
        )}
      </svg>
      <span className="relative flex flex-col items-center justify-center text-center px-2">{children}</span>
    </span>
  );
}
