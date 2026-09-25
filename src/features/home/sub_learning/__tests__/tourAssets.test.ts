import { describe, expect, it } from 'vitest';

import { TOUR_REGISTRY } from '@/stores/slices/system/tourSlice';
import { TOUR_ICONS } from '../data';
import { TOUR_ILLUSTRATIONS, getTourIllustration } from '../illustrations';

/**
 * The Learning hub decorates each tour from two hand-written maps keyed by
 * `TourDef.id` / `.icon`. Both fail SOFT: a miss falls back to the Compass
 * icon or to no illustration at all, so a renamed or added tour degrades silently and nothing anywhere
 * says so. These assertions derive from `TOUR_REGISTRY` (the enumeration that
 * IS the ground truth) rather than from a second hand-written list, so they
 * fail on the change that causes the drift rather than on a copy of it.
 */
describe('Learning hub tour decoration maps', () => {
  it('has an illustration for every registered tour', () => {
    const missing = TOUR_REGISTRY.filter((tour) => getTourIllustration(tour.id) === undefined).map((t) => t.id);
    expect(missing).toEqual([]);
  });

  it('has no illustration for a tour that no longer exists', () => {
    const ids = new Set(TOUR_REGISTRY.map((t) => t.id as string));
    expect(Object.keys(TOUR_ILLUSTRATIONS).filter((k) => !ids.has(k))).toEqual([]);
  });

  it('resolves every registered tour icon without falling back', () => {
    const missing = TOUR_REGISTRY.filter((tour) => TOUR_ICONS[tour.icon] === undefined).map((t) => `${t.id} -> ${t.icon}`);
    expect(missing).toEqual([]);
  });
});
