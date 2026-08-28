import { describe, it, expect } from 'vitest';
import {
  MOTION_PRESETS,
  MOTION_TIMING,
  MOTION_SPRING,
  CSS_DURATION_CLASS,
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

describe('one name, one gesture', () => {
  // Regression guard. MOTION_TIMING.EASE was a spring while
  // CSS_DURATION_CLASS.EASE was a 400ms tween: the same word naming two
  // different gestures, so a component animating one property in Framer and
  // another in CSS got two unrelated motion characters from one name.
  it('MOTION_TIMING names the same rungs as CSS_DURATION_CLASS', () => {
    const cssRungs = Object.keys(CSS_DURATION_CLASS).filter((k) => k === k.toUpperCase());
    expect(Object.keys(MOTION_TIMING).sort()).toEqual(cssRungs.sort());
  });

  it('every MOTION_TIMING rung is a timed tween on the ladder, never a spring', () => {
    for (const [name, transition] of Object.entries(MOTION_TIMING)) {
      expect(transition, name).not.toHaveProperty('type', 'spring');
      expect(LADDER, name).toContain((transition as { duration: number }).duration);
    }
  });

  it('keeps the spring reachable under a name that is not a rung', () => {
    expect(MOTION_SPRING.type).toBe('spring');
    expect(MOTION_SPRING).not.toHaveProperty('duration');
    expect(Object.values(MOTION_TIMING)).not.toContain(MOTION_SPRING);
  });
});
