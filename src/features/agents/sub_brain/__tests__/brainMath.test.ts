import { describe, it, expect } from 'vitest';
import {
  pivotEpisodeSeries,
  presentRoles,
  summarizeConsolidation,
  splitCoverage,
  tierTotal,
} from '../brainMath';
import type { ConsolidationPoint } from '@/lib/bindings/ConsolidationPoint';

const point = (over: Partial<ConsolidationPoint> = {}): ConsolidationPoint => ({
  completedAt: '2026-09-01T00:00:00Z',
  episodesFed: 0,
  created: 0,
  updated: 0,
  rejected: 0,
  skippedTombstoned: 0,
  selfModelDiffsProposed: 0,
  verdict: 'acted',
  ...over,
});

describe('pivotEpisodeSeries', () => {
  it('returns nothing for an empty series rather than a fabricated axis', () => {
    expect(pivotEpisodeSeries([], '2026-09-04')).toEqual([]);
  });

  it('fills the measured gap days between the first row and today', () => {
    const rows = pivotEpisodeSeries(
      [{ day: '2026-09-01', role: 'run', count: 2, chars: 100 }],
      '2026-09-04',
    );
    expect(rows.map((r) => r.day)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ]);
    expect(rows[0]!.run).toBe(2);
    expect(rows[3]!.total).toBe(0);
  });

  it('never invents days BEFORE the first recorded one', () => {
    const rows = pivotEpisodeSeries(
      [{ day: '2026-09-03', role: 'run', count: 1, chars: 10 }],
      '2026-09-04',
    );
    expect(rows[0]!.day).toBe('2026-09-03');
  });

  it('folds an unknown role into the "other" bucket instead of dropping it', () => {
    const rows = pivotEpisodeSeries(
      [
        { day: '2026-09-01', role: 'run', count: 1, chars: 5 },
        { day: '2026-09-01', role: 'assistant', count: 3, chars: 7 },
      ],
      '2026-09-01',
    );
    expect(rows[0]!.other).toBe(3);
    expect(rows[0]!.total).toBe(4);
    expect(rows[0]!.chars).toBe(12);
  });
});

describe('presentRoles', () => {
  it('drops series that are zero everywhere', () => {
    const rows = pivotEpisodeSeries(
      [{ day: '2026-09-01', role: 'channel', count: 4, chars: 9 }],
      '2026-09-01',
    );
    expect(presentRoles(rows)).toEqual(['channel']);
  });
});

describe('summarizeConsolidation', () => {
  it('reports NO cost as null, never as zero', () => {
    const s = summarizeConsolidation([point(), point()]);
    expect(s.costUsd).toBeNull();
  });

  it('sums only the passes that reported a cost', () => {
    const s = summarizeConsolidation([point({ costUsd: 0.25 }), point()]);
    expect(s.costUsd).toBeCloseTo(0.25);
  });

  it('leaves the write rate unmeasured when nothing was ever fed', () => {
    expect(summarizeConsolidation([point()]).yieldRatio).toBeNull();
  });

  it('computes the write rate from created + updated over fed', () => {
    const s = summarizeConsolidation([point({ episodesFed: 10, created: 2, updated: 3 })]);
    expect(s.yieldRatio).toBeCloseTo(0.5);
    expect(s.episodesFed).toBe(10);
  });
});

describe('splitCoverage', () => {
  const charters = [
    { id: 'r1', title: 'Triage inbound' },
    { id: 'r2', title: 'Weekly report' },
  ];

  it('names the charters with NOTHING recorded, which no cell can report', () => {
    const split = splitCoverage([{ key: 'r1', kind: 'responsibility', count: 4 }], charters);
    expect(split.covered.map((r) => r.key)).toEqual(['r1']);
    expect(split.uncovered.map((r) => r.key)).toEqual(['r2']);
    // NOT 0: no cell named r2, so the count is unmeasured. A 0 here would be a
    // claim the coverage read never made, and nothing downstream could undo it.
    expect(split.uncovered[0]!.count).toBeNull();
    expect(split.covered[0]!.count).toBe(4);
  });

  it('separates the unassigned bucket from the charter rows', () => {
    const split = splitCoverage(
      [{ key: 'unassigned', kind: 'responsibility', count: 7 }],
      charters,
    );
    expect(split.unassigned?.count).toBe(7);
    expect(split.uncovered).toHaveLength(2);
  });

  it('reports a cell whose charter is gone as an orphan, not as coverage', () => {
    const split = splitCoverage([{ key: 'r9', kind: 'responsibility', count: 2 }], charters);
    expect(split.orphans.map((r) => r.key)).toEqual(['r9']);
    expect(split.covered).toHaveLength(0);
  });

  it('has nothing to say when there is no roster and no cell', () => {
    const split = splitCoverage([], []);
    expect(split).toEqual({ covered: [], uncovered: [], orphans: [], unassigned: null });
  });
});

describe('tierTotal', () => {
  it('sums the four tiers', () => {
    expect(tierTotal({ core: 1, active: 2, working: 3, archived: 4 })).toBe(10);
  });
});
