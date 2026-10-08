import { describe, it, expect } from 'vitest';

import type { DevGoal } from '@/lib/bindings/DevGoal';

import { GOAL_STATUS_META } from '../../../../goalStatus';
import { bandSegments, formatPct, formatTarget, trackColor } from '../bandsModel';

// Fixture: only the fields the band reads; the rest of DevGoal is irrelevant here.
function goal(id: string, status: string, progress: number | null): DevGoal {
  return { id, status, progress, title: id } as unknown as DevGoal;
}

describe('bandSegments', () => {
  it('draws one segment per goal in the given order, coloured by status', () => {
    const segs = bandSegments([goal('a', 'open', 10), goal('b', 'in_progress', 55), goal('c', 'blocked', 0)]);
    expect(segs.map((s) => s.goal.id)).toEqual(['a', 'b', 'c']);
    expect(segs.map((s) => s.fill)).toEqual([
      GOAL_STATUS_META.open.map.fill,
      GOAL_STATUS_META['in-progress'].map.fill,
      GOAL_STATUS_META.blocked.map.fill,
    ]);
  });

  it('fills a done goal to 100 whatever its stored progress, and clamps the rest', () => {
    const segs = bandSegments([goal('d', 'done', 20), goal('o', 'open', 140), goal('n', 'open', null)]);
    expect(segs.map((s) => s.weight)).toEqual([100, 100, 0]);
  });

  it('draws nothing for no goals (the caller renders the empty track)', () => {
    expect(bandSegments([])).toEqual([]);
  });
});

describe('trackColor', () => {
  it('is the same hue, lightened', () => {
    expect(trackColor('#10B981')).toBe('color-mix(in srgb, #10B981 18%, transparent)');
  });
});

describe('formatTarget', () => {
  const now = new Date('2026-10-08T12:00:00Z');

  it('omits the year inside the current year', () => {
    const s = formatTarget('2026-11-03T12:00:00Z', 'en', now);
    expect(s).toContain('Nov');
    expect(s).not.toContain('2026');
  });

  it('shows the year outside it', () => {
    expect(formatTarget('2027-01-15T12:00:00Z', 'en', now)).toContain('2027');
  });

  it('returns null for a missing or broken date, never "Invalid Date"', () => {
    expect(formatTarget(null, 'en', now)).toBeNull();
    expect(formatTarget('not a date', 'en', now)).toBeNull();
  });
});

describe('formatPct', () => {
  it('formats in the reader language', () => {
    expect(formatPct(42, 'en')).toBe('42%');
    expect(formatPct(100, 'en')).toBe('100%');
    expect(formatPct(0, 'en')).toBe('0%');
  });
});
