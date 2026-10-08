/**
 * The milestone's quantity, DRAWN: a ring for the whole cut and a segmented
 * strip with one segment per bound goal (its status colour, filled to its own
 * weight), so the header shows both how far the cut is and what it is made of.
 *
 * A figure, not structure (ui law, doctrine 6c): a labelled list of the same
 * numbers loses the composition, which is the point. The numbers are also
 * written out in text beside it, so nothing here is the only carrier.
 *
 * `progress === null` (no goals bound) draws a dashed, unfilled ring - an empty
 * cut has no progress to claim, and a 0% would say one was measured.
 */
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { goalStatusMeta } from '../../../goalStatus';
import { goalWeight } from '../layerModel';

const R = 27;

export function ProgressRing({ progress, toneText }: { progress: number | null; toneText: string }) {
  return (
    <div className={`relative w-20 h-20 shrink-0 ${toneText}`} data-testid="layers-detail-progress-ring">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90" aria-hidden>
        {progress === null ? (
          <circle cx={32} cy={32} r={R} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={2} strokeDasharray="4 4" />
        ) : (
          <>
            <circle cx={32} cy={32} r={R} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={6} />
            <circle
              cx={32}
              cy={32}
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth={6}
              pathLength={100}
              strokeDasharray={`${progress} 100`}
              strokeLinecap={progress > 0 ? 'round' : 'butt'}
              className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
            />
          </>
        )}
      </svg>
      {progress !== null && (
        <span className="absolute inset-0 flex items-center justify-center typo-data-lg text-foreground tabular-nums" aria-hidden>
          {progress}%
        </span>
      )}
    </div>
  );
}

/** Past this many goals a segment would be a hairline; the strip caps and the
 *  text line beside it still carries the full count. */
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
