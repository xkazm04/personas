import { describe, expect, it } from 'vitest';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { DAY, isRecentlyDone } from '../progressShared';
import { passesFilter } from '../shared/useProgressModel';

const NOW = Date.parse('2026-10-19T12:00:00Z');

function goal(over: Partial<DevGoal>): DevGoal {
  return {
    id: 'g', project_id: 'p', status: 'done', progress: 100,
    target_date: null, completed_at: null,
    ...over,
  } as DevGoal;
}

describe('isRecentlyDone: the completion stamp decides, never the target', () => {
  it('a done goal finished 2 days ago is recent', () => {
    expect(isRecentlyDone(goal({ completed_at: new Date(NOW - 2 * DAY).toISOString() }), NOW)).toBe(true);
  });

  it('a done goal finished 10 days ago is not', () => {
    expect(isRecentlyDone(goal({ completed_at: new Date(NOW - 10 * DAY).toISOString() }), NOW)).toBe(false);
  });

  it('a done goal with no stamp is old history even when its target is inside the window', () => {
    const g = goal({ target_date: new Date(NOW - 1 * DAY).toISOString() });
    expect(isRecentlyDone(g, NOW)).toBe(false);
    expect(passesFilter(g, 'recent', NOW)).toBe(false);
  });

  it('a done goal with no stamp and a FUTURE target is not "recent"', () => {
    const g = goal({ target_date: new Date(NOW + 30 * DAY).toISOString() });
    expect(isRecentlyDone(g, NOW)).toBe(false);
  });

  it('the stamp wins over a stale target', () => {
    const g = goal({
      target_date: new Date(NOW - 60 * DAY).toISOString(),
      completed_at: new Date(NOW - 1 * DAY).toISOString(),
    });
    expect(isRecentlyDone(g, NOW)).toBe(true);
  });

  it('an ongoing goal always passes the filter', () => {
    expect(passesFilter(goal({ status: 'in-progress' }), 'none', NOW)).toBe(true);
  });
});
