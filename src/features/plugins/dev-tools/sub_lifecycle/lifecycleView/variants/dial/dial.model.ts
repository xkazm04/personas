/**
 * DIAL's geometry and its one figure-level fact. Pure, so the arcs, the spoke
 * positions and the coverage figure are testable without a DOM - a drawn figure
 * whose maths lives in the component is a figure nobody can check.
 *
 * The ring runs CLOCKWISE FROM 12 O'CLOCK in journey order: step 1 is at the top
 * and the cycle closes where it began, which is the whole reason this container
 * exists. Every step gets an equal slot, so a slot's angular position IS its
 * position in the sequence and no step is drawn as more important than another.
 *
 * The gap between two steps inside a lane is small and the gap at a LANE
 * BOUNDARY is large, so "before the task" and "after the task" read as two arcs
 * rather than one undifferentiated crown. There are two boundaries on a closed
 * ring (before -> after, and after -> before again), which is why the wide pad
 * is applied at index 0 and at the first after-lane step.
 *
 * `SIZE` is the SVG viewBox AND the pixel side of the HTML box laid over it, so
 * the two coordinate systems are the same one and a spoke's fractional position
 * can be a CSS percentage. Positions are fractions rather than pixels for that
 * reason: the box may be sized in rem and still track the figure.
 */
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';

import type { JourneyNode } from '../../../journey/journeyModel';

export const SIZE = 352;
export const CENTRE = SIZE / 2;
export const RING_R = 100;
export const LABEL_R = 141;
export const HUB_R = 62;

/** Degrees of blank arc on each side of a step, inside a lane and at a lane boundary. */
const PAD = 1.6;
const LANE_PAD = 6;

export interface DialSpoke {
  node: JourneyNode;
  /** Arc span, degrees clockwise from 12 o'clock. */
  from: number;
  to: number;
  mid: number;
  /** Centre of the step's control, as a fraction of the box. */
  x: number;
  y: number;
  /** Centre of its caption, same frame. */
  labelX: number;
  labelY: number;
  /** Which side of the dial the caption sits on, so it can hug the ring. */
  side: 'left' | 'right';
}

export function polar(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CENTRE + r * Math.cos(rad), y: CENTRE + r * Math.sin(rad) };
}

/** One arc of the crown. Every slot is under 180 degrees, so large-arc is always 0. */
export function arcPath(r: number, from: number, to: number): string {
  const a = polar(r, from);
  const b = polar(r, to);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function dialSpokes(order: JourneyNode[], afterStart: number): DialSpoke[] {
  const n = order.length;
  if (n === 0) return [];
  const slot = 360 / n;
  return order.map((node, i) => {
    const boundary = i === 0 || i === afterStart;
    const next = (i + 1) % n === 0 || i + 1 === afterStart;
    const from = i * slot + (boundary ? LANE_PAD : PAD);
    const to = (i + 1) * slot - (next ? LANE_PAD : PAD);
    const mid = (i + 0.5) * slot;
    const p = polar(RING_R, mid);
    const l = polar(LABEL_R, mid);
    return {
      node, from, to, mid,
      x: p.x / SIZE, y: p.y / SIZE,
      labelX: l.x / SIZE, labelY: l.y / SIZE,
      side: mid > 180 ? 'left' : 'right',
    };
  });
}

/**
 * Steps the app actually enforces. `detected` is excluded on purpose - the
 * product's own phrase for it is "only detected, not installed" - so the hub's
 * figure never claims coverage the repo does not have.
 */
export function enforcedCount(order: JourneyNode[]): number {
  const live: LifecycleBindingState = 'live';
  return order.filter((n) => n.strongestState === live).length;
}
