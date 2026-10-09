import { describe, expect, it } from 'vitest';

import { healthyMix } from '../../../journey/__tests__/fixtures';
import { CHANGE_CAP, cellRow, coverageDomain, coverageSeries, timeline, travelHealth, whatChanged } from '../historyModel';
import { historyOf, sixMeasures } from './historyFixtures';

const kinds = (f: ReturnType<typeof whatChanged>) => f?.map((x) => `${x.kind}:${x.stepId}:${x.tone}`);

describe('history model', () => {
  it('draws oldest first, and is empty with no history', () => {
    const cols = timeline(sixMeasures());
    expect(cols.map((c) => c.measureId)).toEqual(['m-h1', 'm-h2', 'm-h3', 'm-h4', 'm-h5', 'm-h6']);
    expect(timeline(null)).toEqual([]);
  });

  it('turns a past cell into a health row whose previous is the Measure before it', () => {
    const cols = timeline(sixMeasures());
    const row = cellRow(cols[2]!, cols[1]!, 'gate')!;
    expect(row.health).toBe('red');
    expect(row.measuredAt).toBe(cols[2]!.finishedAt);
    expect(row.headSha).toBe(cols[2]!.headSha);
    expect(row.previous?.health).toBe('green');
    expect(row.previous?.headSha).toBe(cols[1]!.headSha);
    expect(cellRow(cols[0]!, null, 'gate')!.previous).toBeNull();
    expect(cellRow(cols[0]!, null, 'docs')).toBeNull();
  });

  it('travels only the tracked steps, keeping every other row as it is now', () => {
    const now = healthyMix().health;
    const cols = timeline(sixMeasures());
    const rows = travelHealth(now, cols, 2, ['gate', 'tests']);
    expect(rows.find((r) => r.stepId === 'gate')!.health).toBe('red');
    expect(rows.find((r) => r.stepId === 'tests')!.metrics.find((m) => m.key === 'coverage_pct')!.value).toBe(58);
    expect(rows.find((r) => r.stepId === 'land')).toBe(now.find((r) => r.stepId === 'land'));
    expect(rows).toHaveLength(now.length);
  });

  it('says what changed between the newest two, with the rail delta conventions', () => {
    const cols = timeline(sixMeasures());
    const f = whatChanged(cols, 5, ['gate', 'tests'])!;
    // Gate regressed green -> amber; coverage +2; the pass rate fell; the cap keeps the sentence short.
    expect(kinds(f)).toEqual(['verdict:gate:bad', 'coverage:tests:good', 'pass:gate:bad']);
    expect(f).toHaveLength(CHANGE_CAP);
    const cov = f[1]!;
    expect(cov.kind === 'coverage' && cov.delta.change).toBe(2);
  });

  it('calls a recovery good and orders times last', () => {
    const cols = timeline(sixMeasures());
    const f = whatChanged(cols, 4, ['gate'])!;
    expect(kinds(f)).toEqual(['verdict:gate:good', 'pass:gate:good', 'time:gate:good']);
    const time = f[2]!;
    expect(time.kind === 'time' && time.delta.change).toBe(-11_000);
  });

  it('is empty when nothing moved, and null with nothing earlier to compare', () => {
    const flat = historyOf([
      { gate: ['green', 100, 50_000], tests: ['amber', 60, 190_000] },
      { gate: ['green', 100, 50_400], tests: ['amber', 60, 190_200] },
    ]);
    expect(whatChanged(timeline(flat), 1, ['gate', 'tests'])).toEqual([]);
    expect(whatChanged(timeline(flat), 0, ['gate', 'tests'])).toBeNull();
  });

  it('reports only coverage when only coverage moved', () => {
    const cov = historyOf([
      { gate: ['green', 100, 50_000], tests: ['amber', 60, 190_000] },
      { gate: ['green', 100, 50_000], tests: ['amber', 64, 190_000] },
    ]);
    expect(kinds(whatChanged(timeline(cov), 1, ['gate', 'tests']))).toEqual(['coverage:tests:good']);
  });

  it('draws the coverage line in a zoomed band, never a fake zero', () => {
    const cols = timeline(historyOf([
      { gate: ['green', 100, 1], tests: ['unmeasured', null, 1] },
      { gate: ['green', 100, 1], tests: ['amber', 63, 1] },
    ]));
    expect(coverageSeries(cols)).toEqual([null, 63]);
    const d = coverageDomain([null, 63], 70, 50);
    expect(d.lo).toBe(46);
    expect(d.hi).toBe(74);
    expect(coverageDomain([95], 96, 94).hi - coverageDomain([95], 96, 94).lo).toBeGreaterThanOrEqual(20);
  });
});
