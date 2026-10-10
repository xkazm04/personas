import { describe, expect, it } from 'vitest';

import { healthyMix, prev } from '../../../journey/__tests__/fixtures';
import { buildLanes } from '../../../journey/journeyModel';
import { signedChange } from '../rail/DeltaMark';
import { higherIsBetter, metricDelta, stepChange } from '../delta';
import { joinHealth, type HealthStep } from '../healthModel';

function steps(): Map<string, HealthStep> {
  const snap = healthyMix();
  const lanes = buildLanes(snap);
  return new Map(joinHealth([...lanes.before, ...lanes.after], snap.health).map((s) => [s.node.id, s]));
}

describe('metricDelta', () => {
  it('judges direction per metric: a higher rate is good, a longer time is bad', () => {
    expect(higherIsBetter('pass_rate')).toBe(true);
    expect(higherIsBetter('coverage_pct')).toBe(true);
    expect(higherIsBetter('docs_clean_pct')).toBe(true);
    expect(higherIsBetter('done_rate')).toBe(true);
    expect(higherIsBetter('median_ms')).toBe(false);

    expect(metricDelta('coverage_pct', 63, 57)).toMatchObject({ change: 6, direction: 'up', tone: 'good' });
    expect(metricDelta('pass_rate', 90, 100)).toMatchObject({ change: -10, direction: 'down', tone: 'bad' });
    expect(metricDelta('median_ms', 74_000, 52_000)).toMatchObject({ change: 22_000, direction: 'up', tone: 'bad' });
    expect(metricDelta('median_ms', 110_000, 182_000)).toMatchObject({ change: -72_000, direction: 'down', tone: 'good' });
  });

  it('never compares against an unknown, and reads a move below the shown precision as flat', () => {
    expect(metricDelta('done_rate', 40, null)).toBeNull();
    expect(metricDelta('done_rate', null, 52)).toBeNull();
    expect(metricDelta('done_rate', 85, 85.3)).toMatchObject({ change: 0, direction: 'flat', tone: 'neutral' });
    expect(metricDelta('median_ms', 74_200, 74_000)).toMatchObject({ direction: 'flat' });
    // Never a negative zero that would print as "-0".
    expect(Object.is(metricDelta('done_rate', 85, 85.4)!.change, -0)).toBe(false);
  });

  it('signs and formats a change for its metric', () => {
    expect(signedChange(metricDelta('coverage_pct', 63, 57)!, 'en')).toBe('+6');
    expect(signedChange(metricDelta('done_rate', 40, 52)!, 'en')).toBe('−12');
    expect(signedChange(metricDelta('median_ms', 110_000, 182_000)!, 'en')).toBe('−1m 12s');
  });
});

describe('stepChange', () => {
  it('is null with no earlier measure, so nothing draws a "+0"', () => {
    const sync = steps().get('sync')!;
    expect(sync.previous).toBeNull();
    expect(stepChange(sync)).toBeNull();
    expect(stepChange(steps().get('frame')!)).toBeNull();
  });

  it('carries the figure change and every metric change, and the verdict it was when it differs', () => {
    const gate = stepChange(steps().get('gate')!)!;
    expect(gate.figure).toMatchObject({ key: 'pass_rate', change: -10, tone: 'bad' });
    expect(gate.metrics.map((d) => d.key)).toEqual(['median_ms', 'pass_rate']);
    expect(gate.was).toBe('green');

    const land = stepChange(steps().get('land')!)!;
    expect(land.figure).toMatchObject({ change: -12, direction: 'down' });
    expect(land.was).toBe('amber');

    const isolate = stepChange(steps().get('isolate')!)!;
    expect(isolate.figure).toMatchObject({ change: 6, direction: 'up', tone: 'good' });
    expect(isolate.was).toBeNull();
  });

  it('says what a stale step was, and keeps an unchanged figure flat', () => {
    const commit = stepChange(steps().get('commit')!)!;
    expect(commit.figure?.direction).toBe('flat');
    expect(commit.was).toBe('green');

    const record = stepChange(steps().get('record')!)!;
    expect(record.figure?.direction).toBe('flat');
    expect(record.was).toBeNull();
  });

  it('reads an earlier measure with no value as no change, but still a changed verdict', () => {
    const step = { ...steps().get('sync')!, health: 'green' as const, previous: prev('unmeasured', [['done_rate', null, 3]]) };
    step.metrics = [{ key: 'done_rate', value: 85, samples: 7, ratio: 0.85 }];
    step.figure = step.metrics[0]!;
    const change = stepChange(step)!;
    expect(change.figure).toBeNull();
    expect(change.metrics).toEqual([]);
    expect(change.was).toBe('unmeasured');
  });
});
