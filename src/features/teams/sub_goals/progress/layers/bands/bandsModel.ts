/**
 * The BANDS figure's numbers, kept pure so the drawing and the test agree.
 *
 * A band is one milestone cut into one segment per bound goal. Each segment
 * is a light track of the goal's status colour filled solid to the goal's
 * weight - the same `goalWeight` the milestone's percent is the mean of, so
 * the eye can sum the segments and land on the number printed beside them.
 */
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { goalStatusMeta } from '../../../goalStatus';
import { goalWeight } from '../layerModel';

export interface BandSegment {
  goal: DevGoal;
  /** 0-100: how far the segment is filled. */
  weight: number;
  /** The goal's status colour as a hex, for an inline fill. */
  fill: string;
}

export function bandSegments(goals: readonly DevGoal[]): BandSegment[] {
  return goals.map((goal) => ({
    goal,
    weight: goalWeight(goal),
    fill: goalStatusMeta(goal.status).map.fill,
  }));
}

/** The track behind a segment's fill: the same hue, much lighter. */
export function trackColor(fill: string): string {
  return `color-mix(in srgb, ${fill} 18%, transparent)`;
}

export { formatPct, formatTarget } from '../layerFormat';
