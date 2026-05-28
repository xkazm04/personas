import { describe, it, expect } from 'vitest';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';
import { computeFleetPulse, layoutSlots } from './fleetStripModel';

function mkProc(o: Partial<ActiveProcess>): ActiveProcess {
  return {
    domain: 'execution',
    startedAt: 1000,
    status: 'running',
    toolCallCount: 0,
    costUsd: 0,
    ...o,
  } as ActiveProcess;
}

describe('computeFleetPulse', () => {
  it('counts running and queued, ignoring terminal states', () => {
    const p = computeFleetPulse({
      a: mkProc({ status: 'running' }),
      b: mkProc({ status: 'running' }),
      c: mkProc({ status: 'queued' }),
      d: mkProc({ status: 'completed' }),
      e: mkProc({ status: 'failed' }),
    });
    expect(p.running).toBe(2);
    expect(p.queued).toBe(1);
  });

  it('tracks the oldest running start and sums running cost only', () => {
    const p = computeFleetPulse({
      a: mkProc({ status: 'running', startedAt: 5000, costUsd: 0.01 }),
      b: mkProc({ status: 'running', startedAt: 2000, costUsd: 0.02 }),
      c: mkProc({ status: 'queued', startedAt: 1, costUsd: 99 }),
    });
    expect(p.oldestRunningSince).toBe(2000);
    expect(p.liveCostUsd).toBeCloseTo(0.03, 6);
  });

  it('returns a null oldest when nothing is running', () => {
    const p = computeFleetPulse({ c: mkProc({ status: 'queued' }) });
    expect(p.running).toBe(0);
    expect(p.oldestRunningSince).toBeNull();
  });
});

describe('layoutSlots', () => {
  it('fills running cells, then a queued tail, then empty', () => {
    const slots = layoutSlots({ running: 2, queued: 1, oldestRunningSince: 0, liveCostUsd: 0 }, 5);
    expect(slots).toEqual(['running', 'running', 'queued', 'empty', 'empty']);
  });

  it('caps running at the slot count and drops the queued tail when full', () => {
    const slots = layoutSlots({ running: 7, queued: 3, oldestRunningSince: 0, liveCostUsd: 0 }, 5);
    expect(slots).toEqual(['running', 'running', 'running', 'running', 'running']);
  });

  it('only fills the queued tail into the room running leaves', () => {
    const slots = layoutSlots({ running: 3, queued: 10, oldestRunningSince: 0, liveCostUsd: 0 }, 5);
    expect(slots).toEqual(['running', 'running', 'running', 'queued', 'queued']);
  });

  it('is all-empty for an idle fleet', () => {
    const slots = layoutSlots({ running: 0, queued: 0, oldestRunningSince: null, liveCostUsd: 0 }, 4);
    expect(slots).toEqual(['empty', 'empty', 'empty', 'empty']);
  });
});
