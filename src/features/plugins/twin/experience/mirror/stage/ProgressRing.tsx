/**
 * The four slots as four arcs of one ring around the twin's disc.
 *
 * This is the "reserved frame that fills": all four arcs are drawn from the
 * first frame, empty and faint, and each one FILLS as its slot is completed —
 * so progress is a shape changing rather than a number changing, and the
 * person can see what is left without a panel listing it.
 *
 * Colour comes from `twinStatus`, the one presentation table for these four
 * slots, via `currentColor` — so the ring never invents a palette, and shape
 * (how far an arc has drawn) carries the same information as colour for anyone
 * who cannot separate the two.
 */

import type { ReactNode } from 'react';
import type { SetupChecklistItem } from '../../../setup/setupContract';
import { twinStatusEntry, type TwinSlotStatus } from '../../../shared/twinStatus';

/** How much of its arc each status draws. */
const FILL: Record<TwinSlotStatus, number> = { set: 1, partial: 0.5, empty: 0 };

const SIZE = 56;
const C = SIZE / 2;
const R = 24;
const GAP = 7; // degrees of clear air between two arcs

function arcPath(index: number, count: number): string {
  const span = 360 / count;
  const from = -90 + index * span + GAP / 2;
  const to = from + span - GAP;
  const p = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(C + R * Math.cos(rad)).toFixed(2)} ${(C + R * Math.sin(rad)).toFixed(2)}`;
  };
  return `M ${p(from)} A ${R} ${R} 0 0 1 ${p(to)}`;
}

interface ProgressRingProps {
  checklist: SetupChecklistItem[];
  /** The disc the ring is drawn around. */
  children: ReactNode;
}

export function ProgressRing({ checklist, children }: ProgressRingProps) {
  return (
    <span className="relative inline-flex items-center justify-center" data-testid="mr-ring">
      <svg
        aria-hidden
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute inset-0 w-full h-full overflow-visible"
        fill="none"
      >
        {checklist.map((item, i) => {
          const d = arcPath(i, checklist.length);
          const entry = twinStatusEntry(item.status);
          return (
            <g key={item.id}>
              {/* The reserved arc: always there, so nothing on this ring pops
                  in. Faded with SVG's own `stroke-opacity` rather than a
                  low-opacity text token — this is a stroke, not body text. */}
              <path
                d={d}
                className="text-foreground"
                stroke="currentColor"
                strokeOpacity={0.14}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <path
                d={d}
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - FILL[item.status]}
                className={`mr-arc ${entry.text}`}
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </svg>
      <span className="relative flex items-center justify-center" style={{ width: SIZE, height: SIZE }}>
        {children}
      </span>
    </span>
  );
}

export default ProgressRing;
