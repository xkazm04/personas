import { describe, it, expect } from 'vitest';
import {
  MOTION_PRESETS,
  staggerItem,
  dashboardItem,
} from '../animation/animationPresets';

/** The repo's duration ladder, in seconds. Anything else is an invented rung. */
const LADDER = Object.values(MOTION_PRESETS).map((p) => p.framer.duration);

function durationsOf(variants: Record<string, unknown>): number[] {
  const out: number[] = [];
  for (const def of Object.values(variants)) {
    if (def && typeof def === 'object' && 'transition' in def) {
      const transition = (def as { transition?: { duration?: number } }).transition;
      if (typeof transition?.duration === 'number') out.push(transition.duration);
    }
  }
  return out;
}

describe('animation presets stay on the duration ladder', () => {
  it('exposes exactly three rungs', () => {
    expect(LADDER.slice().sort()).toEqual([0.15, 0.25, 0.4]);
  });

  // Regression guard. `dashboardItem` inlined `duration: 0.3` — a fourth rung
  // invented at the definition site, which is exactly the drift MOTION_PRESETS
  // exists to prevent and which no gate would have caught.
  it('dashboardItem draws every duration from MOTION_PRESETS', () => {
    const durations = durationsOf(dashboardItem);
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) expect(LADDER).toContain(d);
    expect(durations).not.toContain(0.3);
  });

  it('staggerItem draws every duration from MOTION_PRESETS', () => {
    const durations = durationsOf(staggerItem);
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) expect(LADDER).toContain(d);
  });
});
