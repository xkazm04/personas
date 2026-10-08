/**
 * Small pieces L2's parts share: the calm ghost a region shows before its first
 * read lands, the first-load latch that decides when it may stop, and the goal
 * progress bar every row draws.
 */
import { useEffect, useRef, useState } from 'react';

import type { DevGoal } from '@/lib/bindings/DevGoal';

import { goalStatusMeta } from '../../../goalStatus';
import { goalWeight } from '../layerModel';

/**
 * Loading pattern v2: placeholder blocks under permanent chrome, never a
 * spinner for a region. Static on purpose - a calm block, not a shimmer.
 */
export function Ghost({ rows = 3, testId }: { rows?: number; testId?: string }) {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden data-testid={testId}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-4 rounded-full bg-secondary/40"
          style={{ width: `${92 - ((i * 17) % 40)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * True once a read has gone loading -> settled at least once. Before that the
 * caller ghosts; after it, a refetch (loading again) never blanks what is
 * painted. Mount it under a `key` that changes with the subject so a new
 * subject starts over.
 */
export function useFirstLoad(loading: boolean): boolean {
  const [settled, setSettled] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (loading) started.current = true;
    else if (started.current) setSettled(true);
  }, [loading]);
  return settled;
}

/**
 * One goal's fill. Drawn in SVG so the status colour can be the canonical
 * `goalStatusMeta(...).map.fill` hex rather than a second colour map.
 */
export function GoalBar({ goal, className = '' }: { goal: DevGoal; className?: string }) {
  const fill = goalStatusMeta(goal.status).map.fill;
  const w = goalWeight(goal);
  return (
    <svg className={`h-1.5 w-full ${className}`} viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden>
      <rect x={0} y={0} width={100} height={6} rx={3} fill={fill} fillOpacity={0.16} />
      {w > 0 && (
        <rect
          x={0}
          y={0}
          width={w}
          height={6}
          rx={3}
          fill={fill}
          className="transition-[width] duration-500 ease-out motion-reduce:transition-none"
        />
      )}
    </svg>
  );
}
