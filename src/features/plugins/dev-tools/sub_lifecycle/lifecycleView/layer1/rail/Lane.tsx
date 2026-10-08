// A lane of the rail: its recessed tray, its eyebrow and step count, then ONE
// row of equal columns, one card per step. The grid stretches every card to
// the tallest, and the cards' fixed rows make them equal anyway, so a lane
// never looks ragged. The rail and its cold-load ghost (`Layer1Ghost`) both
// draw THIS shell, so a ghost lane starts and ends where the real one will.
import type { ReactNode } from 'react';

import { RAIL, lcSurface } from '../../system/lcSurface';

interface LaneProps {
  /** The lane's name; a group label for assistive tech when it is a string. */
  label?: string;
  head: ReactNode;
  count: ReactNode;
  steps: number;
  testId?: string;
  /** `ol` for the rail; the ghost passes `div` (it lists nothing). */
  as?: 'ol' | 'div';
  children: ReactNode;
}

export function Lane({ label, head, count, steps, testId, as: List = 'ol', children }: LaneProps) {
  const n = Math.max(1, steps);
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className={`flex flex-col gap-2 ${lcSurface('lane')}`} data-testid={testId}>
      <div className="flex h-6 items-center justify-between gap-3 px-1">
        {head}
        {count}
      </div>
      <List
        className="grid items-stretch"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, columnGap: `${RAIL.gapRem}rem` }}
      >
        {children}
      </List>
    </div>
  );
}
