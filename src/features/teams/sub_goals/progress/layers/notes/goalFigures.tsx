/**
 * The two goal figures the Notes bands draw, in SVG so the status colour is the
 * canonical `goalStatusMeta(...).map.fill` rather than a second colour map:
 * a milestone's goals as one segment strip, and one goal's fill bar.
 */
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { goalStatusMeta } from '../../../goalStatus';
import { goalWeight } from '../layerModel';

const MAX_SEGMENTS = 40;
const SEG = 10;
const GAP = 1.5;

export function GoalSegments({ goals }: { goals: readonly DevGoal[] }) {
  if (goals.length === 0) return null;
  const shown = goals.slice(0, MAX_SEGMENTS);
  const width = shown.length * SEG;
  return (
    <svg
      viewBox={`0 0 ${width} 8`}
      preserveAspectRatio="none"
      className="h-2 w-full max-w-md"
      aria-hidden
      data-testid="layers-detail-goal-segments"
    >
      {shown.map((g, i) => {
        const fill = goalStatusMeta(g.status).map.fill;
        const x = i * SEG;
        const w = SEG - GAP;
        return (
          <g key={g.id}>
            <rect x={x} y={0} width={w} height={8} rx={1.5} fill={fill} fillOpacity={0.18} />
            <rect x={x} y={0} width={(w * goalWeight(g)) / 100} height={8} rx={1.5} fill={fill} />
          </g>
        );
      })}
    </svg>
  );
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
