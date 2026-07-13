import { describe, it, expect } from 'vitest';
import { computeActivePersonaWindow, computeEventWindow } from './homeSpineWindows';

const NOW = Date.parse('2026-07-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

describe('computeActivePersonaWindow', () => {
  it('returns zeros for an empty sample', () => {
    expect(computeActivePersonaWindow([], NOW)).toEqual({ curr: 0, prev: 0 });
  });

  it('counts DISTINCT personas in the trailing 24h', () => {
    const rows = [
      { persona_id: 'a', created_at: iso(NOW - HOUR) },
      { persona_id: 'a', created_at: iso(NOW - 2 * HOUR) }, // same persona, still 1
      { persona_id: 'b', created_at: iso(NOW - 3 * HOUR) },
    ];
    expect(computeActivePersonaWindow(rows, NOW)).toEqual({ curr: 2, prev: 0 });
  });

  it('splits current vs prior day at the 24h boundary', () => {
    const rows = [
      { persona_id: 'a', created_at: iso(NOW - HOUR) },        // curr
      { persona_id: 'b', created_at: iso(NOW - DAY - HOUR) },  // prev
      { persona_id: 'c', created_at: iso(NOW - 2 * DAY - HOUR) }, // outside both windows
    ];
    expect(computeActivePersonaWindow(rows, NOW)).toEqual({ curr: 1, prev: 1 });
  });

  it('skips future-dated and unparseable rows', () => {
    const rows = [
      { persona_id: 'a', created_at: iso(NOW + HOUR) }, // future → skipped
      { persona_id: 'b', created_at: 'not-a-date' },    // unparseable → skipped
      { persona_id: 'c', created_at: iso(NOW - HOUR) }, // counted
    ];
    expect(computeActivePersonaWindow(rows, NOW)).toEqual({ curr: 1, prev: 0 });
  });
});

describe('computeEventWindow', () => {
  it('returns zeros for an empty sample', () => {
    expect(computeEventWindow([], NOW)).toEqual({ curr: 0, prev: 0 });
  });

  it('counts volume (not distinct) on each side of the 24h cutoff', () => {
    const events = [
      { created_at: iso(NOW - HOUR) },
      { created_at: iso(NOW - 2 * HOUR) },
      { created_at: iso(NOW - DAY - HOUR) },
    ];
    expect(computeEventWindow(events, NOW)).toEqual({ curr: 2, prev: 1 });
  });

  it('treats the exact 24h cutoff as current (>=)', () => {
    const events = [{ created_at: iso(NOW - DAY) }];
    expect(computeEventWindow(events, NOW)).toEqual({ curr: 1, prev: 0 });
  });

  it('skips unparseable timestamps', () => {
    const events = [{ created_at: 'nope' }, { created_at: iso(NOW - HOUR) }];
    expect(computeEventWindow(events, NOW)).toEqual({ curr: 1, prev: 0 });
  });
});
