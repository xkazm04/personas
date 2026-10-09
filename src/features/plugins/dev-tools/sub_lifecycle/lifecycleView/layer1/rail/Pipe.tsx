/**
 * The pipe between two cards of a lane: it leaves one card's meter, crosses
 * the gutter and enters the next card's meter on the same line, so a lane
 * reads as one flow, left to right.
 *
 * - It is drawn in the DOWNSTREAM step's verdict, in that verdict's stroke
 *   (solid, dashed for not measured, dotted for stale, a hairline for an
 *   instructed step), with a chevron that says which way the work flows.
 * - After a FAILING step the pipe is BROKEN: two stubs and a gap with a break
 *   mark in the failing ink. Work that left a failing step did not flow on as
 *   the practice says, and the rail says where.
 *
 * Positioned from the downstream card's meter row: it reaches back over that
 * card's padding, the gutter and the upstream card's padding (`system/RAIL`).
 */
import { ChevronRight, Unlink2 } from 'lucide-react';

import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import { RAIL } from '../../system/lcSurface';
import { GLYPH } from '../../system/scales';
import { VERDICT } from '../healthModel';

const STROKE: Record<LifecycleHealth, string> = {
  green: 'border-t-2 border-solid',
  amber: 'border-t-2 border-solid',
  red: 'border-t-2 border-solid',
  unmeasured: 'border-t-2 border-dashed',
  stale: 'border-t-2 border-dotted',
  instructed: 'border-t border-solid',
};

/** The pipe's reach: the gutter, both cards' padding, both cards' 2px borders. */
const REACH = `calc(${RAIL.gapRem + 2 * RAIL.padRem}rem + 4px)`;

interface PipeProps {
  /** The verdict of the card the pipe flows INTO. */
  downstream: LifecycleHealth;
  /** The verdict of the card it leaves; a failing one breaks the pipe. */
  upstream: LifecycleHealth;
  dim?: boolean;
}

export function Pipe({ downstream, upstream, dim = false }: PipeProps) {
  const broken = upstream === 'red';
  const ink = broken ? VERDICT.red.ink : downstream === 'instructed' ? 'text-primary' : VERDICT[downstream].ink;
  const line = `h-0 flex-1 border-current ${STROKE[broken ? 'red' : downstream]}`;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute right-full top-1/2 z-10 flex -translate-y-1/2 items-center ${ink} transition-opacity duration-200 motion-reduce:transition-none ${dim ? 'opacity-40' : 'opacity-100'}`}
      style={{ width: REACH }}
      data-pipe={broken ? 'broken' : 'flow'}
    >
      {broken ? (
        <>
          <span className={line} />
          <Unlink2 className={`${GLYPH.md} shrink-0`} strokeWidth={2.5} />
          <span className="flex-1" />
        </>
      ) : (
        <>
          <span className={line} />
          <ChevronRight className={`${GLYPH.sm} -ml-1.5 shrink-0`} strokeWidth={3} />
        </>
      )}
    </span>
  );
}
