// The Timeline view's deadline sense, now the Board's ordering. These assert
// the three judgements that made the fold safe to do: urgency beats raw date,
// "no date" is not "due now", and a heading only appears where grouping means
// something.
import { describe, it, expect } from 'vitest';

import type { DevGoal } from '@/lib/bindings/DevGoal';
import { goalBucket, orderGoalsByProjectThenDeadline, projectRunHeads } from '../goalChronology';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const day = (n: number) => new Date(NOW + n * 86400000).toISOString();

function goal(id: string, projectId: string, targetDate: string | null, title = id): DevGoal {
  return { id, project_id: projectId, title, target_date: targetDate } as unknown as DevGoal;
}

describe('goalBucket', () => {
  it('bands a date by urgency', () => {
    expect(goalBucket(day(-1), NOW)).toBe('overdue');
    expect(goalBucket(day(3), NOW)).toBe('this_week');
    expect(goalBucket(day(20), NOW)).toBe('this_month');
    expect(goalBucket(day(200), NOW)).toBe('later');
  });

  it('treats a missing OR unparseable date as undated, never as overdue', () => {
    expect(goalBucket(null, NOW)).toBe('undated');
    // A malformed value is missing information. Calling it overdue would invent
    // an alarm the data does not support.
    expect(goalBucket('not-a-date', NOW)).toBe('undated');
  });
});

describe('orderGoalsByProjectThenDeadline', () => {
  it('leads with the project whose earliest deadline is soonest', () => {
    const goals = [
      goal('b1', 'beta', day(30)),
      goal('a1', 'alpha', day(2)),
    ];
    expect(orderGoalsByProjectThenDeadline(goals, NOW).map((g) => g.project_id))
      .toEqual(['alpha', 'beta']);
  });

  it('keeps each project contiguous rather than interleaving by date', () => {
    const goals = [
      goal('a-late', 'alpha', day(40)),
      goal('b-soon', 'beta', day(5)),
      goal('a-soon', 'alpha', day(1)),
    ];
    // alpha leads (earliest deadline, day 1) and takes BOTH its goals with it:
    // a global date sort would have put b-soon between them.
    expect(orderGoalsByProjectThenDeadline(goals, NOW).map((g) => g.id))
      .toEqual(['a-soon', 'a-late', 'b-soon']);
  });

  it('sorts undated goals last within a project, not first', () => {
    const goals = [
      goal('undated', 'alpha', null),
      goal('later', 'alpha', day(90)),
      goal('overdue', 'alpha', day(-3)),
    ];
    expect(orderGoalsByProjectThenDeadline(goals, NOW).map((g) => g.id))
      .toEqual(['overdue', 'later', 'undated']);
  });

  it('puts a project with no dated goals after every dated one', () => {
    const goals = [goal('u', 'undatedproj', null), goal('d', 'datedproj', day(100))];
    expect(orderGoalsByProjectThenDeadline(goals, NOW).map((g) => g.project_id))
      .toEqual(['datedproj', 'undatedproj']);
  });

  it('is a pure sort: the input array is not mutated', () => {
    const goals = [goal('b', 'beta', day(30)), goal('a', 'alpha', day(2))];
    const before = goals.map((g) => g.id);
    orderGoalsByProjectThenDeadline(goals, NOW);
    expect(goals.map((g) => g.id)).toEqual(before);
  });
});

describe('projectRunHeads', () => {
  it('returns nothing when the lane holds one project', () => {
    const lane = [goal('a', 'alpha', day(1)), goal('b', 'alpha', day(2))];
    // A heading over every card in a single-project lane says nothing.
    expect(projectRunHeads(lane).size).toBe(0);
  });

  it('marks the first card of each project run', () => {
    const lane = [
      goal('a1', 'alpha', day(1)),
      goal('a2', 'alpha', day(2)),
      goal('b1', 'beta', day(3)),
    ];
    expect([...projectRunHeads(lane)]).toEqual(['a1', 'b1']);
  });
});
