import { describe, it, expect } from 'vitest';
import {
  matchPastSlotsToRuns,
  classifyRunOutcome,
  SLOT_RUN_TOLERANCE_MS,
  type RunPoint,
} from '../calendarHelpers';

const MIN = 60_000;
const base = new Date('2026-05-01T00:00:00Z').getTime();
const slot = (m: number) => base + m * MIN;

describe('classifyRunOutcome', () => {
  it('maps terminal success/failure and leaves non-terminal unknown', () => {
    expect(classifyRunOutcome('completed')).toBe('past-success');
    expect(classifyRunOutcome('failed')).toBe('past-failure');
    expect(classifyRunOutcome('error')).toBe('past-failure');
    expect(classifyRunOutcome('cancelled')).toBe('past-failure');
    expect(classifyRunOutcome('running')).toBe('past-unknown');
    expect(classifyRunOutcome('queued')).toBe('past-unknown');
    expect(classifyRunOutcome('COMPLETED')).toBe('past-success'); // case-insensitive
  });
});

describe('matchPastSlotsToRuns', () => {
  it('binds a run stamped a few seconds late (tick lateness) to its slot', () => {
    const slots = [slot(0), slot(60), slot(120)]; // hourly
    const runs: RunPoint[] = [
      { time: slot(0) + 4_000, status: 'completed' },   // 4s late
      { time: slot(120) + 5_000, status: 'failed' },    // 5s late
    ];
    expect(matchPastSlotsToRuns(slots, runs)).toEqual([
      'past-success',
      'past-unknown', // slot(60) had no run → honestly unknown (a real skip)
      'past-failure',
    ]);
  });

  it('leaves every slot unknown when there are no runs', () => {
    const slots = [slot(0), slot(15), slot(30)];
    expect(matchPastSlotsToRuns(slots, [])).toEqual([
      'past-unknown',
      'past-unknown',
      'past-unknown',
    ]);
  });

  it('does not bind a backfilled run whose stamp is far from any nominal slot', () => {
    const slots = [slot(0), slot(60)];
    // Backfill enqueued 3 hours after the missed slots → outside tolerance.
    const runs: RunPoint[] = [{ time: slot(180), status: 'completed' }];
    expect(matchPastSlotsToRuns(slots, runs)).toEqual(['past-unknown', 'past-unknown']);
  });

  it('respects the base tolerance boundary (inclusive) and rejects just beyond', () => {
    const withinSlots = [slot(0)];
    const within: RunPoint[] = [{ time: slot(0) + SLOT_RUN_TOLERANCE_MS, status: 'completed' }];
    expect(matchPastSlotsToRuns(withinSlots, within)).toEqual(['past-success']);

    const beyond: RunPoint[] = [{ time: slot(0) + SLOT_RUN_TOLERANCE_MS + 1, status: 'completed' }];
    expect(matchPastSlotsToRuns(withinSlots, beyond)).toEqual(['past-unknown']);
  });

  it('caps tolerance at half the neighbour gap so a slot cannot steal its neighbour’s run', () => {
    // 60s-apart slots → per-slot tolerance capped at 30s (< base 90s). A run 50s
    // after slot 0 actually belongs to slot 1 (10s away). Without the cap, slot
    // 0's 90s window would greedily grab it; with the cap slot 0 stays unknown
    // and slot 1 gets its real outcome.
    const slots = [slot(0), slot(0) + 60_000];
    const runs: RunPoint[] = [{ time: slot(0) + 50_000, status: 'completed' }];
    expect(matchPastSlotsToRuns(slots, runs)).toEqual(['past-unknown', 'past-success']);
  });

  it('each run binds at most one slot (nearest wins)', () => {
    const slots = [slot(0), slot(60)];
    const runs: RunPoint[] = [
      { time: slot(0) + 10_000, status: 'completed' },
      { time: slot(60) - 10_000, status: 'failed' },
    ];
    expect(matchPastSlotsToRuns(slots, runs)).toEqual(['past-success', 'past-failure']);
  });
});
