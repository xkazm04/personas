import { describe, expect, it } from 'vitest';

import { buildLanes } from '../../../journey/journeyModel';
import { healthyMix, soloV0 } from '../../../journey/__tests__/fixtures';
import { expectedMetricKeys, goalParts, healthCounts, joinHealth, metricRatio, stepMetrics } from '../healthModel';

function nodes(snap = soloV0()) {
  const { before, after } = buildLanes(snap);
  return [...before, ...after];
}

describe('joinHealth', () => {
  it('reads a missing row as unmeasured, and as instructed for frame / recall / custom steps', () => {
    const steps = joinHealth(nodes(), []);
    const byId = Object.fromEntries(steps.map((s) => [s.node.id, s]));
    expect(byId.frame!.health).toBe('instructed');
    expect(byId.recall!.health).toBe('instructed');
    expect(byId.gate!.health).toBe('unmeasured');
    expect(byId.land!.health).toBe('unmeasured');
    expect(byId.frame!.metrics).toEqual([]);
    // An unmeasured step still carries its N/A slots: never zero, never a ratio.
    expect(byId.gate!.metrics.map((m) => [m.key, m.value, m.ratio])).toEqual([
      ['median_ms', null, null],
      ['pass_rate', null, null],
    ]);
  });

  it('joins every verdict by step id and keeps a null metric null', () => {
    const snap = healthyMix();
    const steps = joinHealth(nodes(snap), snap.health);
    expect(new Set(steps.map((s) => s.health))).toEqual(new Set(['green', 'amber', 'red', 'unmeasured', 'instructed', 'stale']));
    const sync = steps.find((s) => s.node.id === 'sync')!;
    expect(sync.primary).toEqual({ key: 'done_rate', value: null, samples: 3, ratio: null });
    const gate = steps.find((s) => s.node.id === 'gate')!;
    expect(gate.reason).toBe('tsc 74s over 60s budget');
    expect(gate.metrics[1]).toEqual({ key: 'pass_rate', value: 90, samples: 10, ratio: 0.9 });
  });

  it('counts verdicts across the journey', () => {
    const snap = healthyMix();
    expect(healthCounts(joinHealth(nodes(snap), snap.health))).toEqual({
      green: 3, amber: 2, red: 1, stale: 1, unmeasured: 1, instructed: 2,
    });
  });
});

describe('metrics', () => {
  it('orders the expected slots primary first', () => {
    expect(expectedMetricKeys('tests')).toEqual(['coverage_pct', 'median_ms', 'pass_rate']);
    expect(expectedMetricKeys('commit')).toEqual(['done_rate']);
    expect(expectedMetricKeys('x-custom')).toEqual([]);
  });

  it('draws rates on 0..1 and never a duration or an unknown', () => {
    expect(metricRatio('coverage_pct', 63)).toBeCloseTo(0.63);
    expect(metricRatio('done_rate', 140)).toBe(1);
    expect(metricRatio('median_ms', 74000)).toBeNull();
    expect(metricRatio('pass_rate', null)).toBeNull();
  });

  it('keeps a metric the table does not expect instead of dropping it', () => {
    const out = stepMetrics('docs', {
      stepId: 'docs', health: 'green', staleOf: null, reason: null, measuredAt: null, headSha: null,
      metrics: [{ key: 'median_ms', value: 1200, samples: 4 }, { key: 'docs_clean_pct', value: 92, samples: 38 }],
    });
    expect(out.map((m) => m.key)).toEqual(['docs_clean_pct', 'median_ms']);
  });
});

describe('goalParts', () => {
  it('splits the goal into green, measurable-not-green and instructed', () => {
    expect(goalParts({ goalId: 'g', measurableTotal: 8, measurableGreen: 3, instructed: 2, openItems: 5 }))
      .toEqual({ green: 3, notGreen: 5, instructed: 2 });
  });
});
