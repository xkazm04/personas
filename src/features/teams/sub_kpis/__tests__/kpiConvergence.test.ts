import { describe, it, expect } from 'vitest';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import { computeConvergence, gapSpan, splitChannels } from '../kpiConvergence';

function m(over: Partial<DevKpiMeasurement>): DevKpiMeasurement {
  return {
    id: Math.random().toString(36).slice(2),
    kpi_id: 'k1',
    value: 0,
    measured_at: '2026-07-01 12:00:00',
    source: 'evaluator',
    env: 'production',
    evidence: null,
    note: null,
    ...over,
  };
}
const sim = (measured_at: string, value: number, env = 'local') =>
  m({ measured_at, value, env, source: 'simulation' });
const prod = (measured_at: string, value: number) => m({ measured_at, value });

describe('splitChannels', () => {
  it('routes by env with production as the legacy default', () => {
    const { production, sim: s } = splitChannels([
      prod('2026-07-01 12:00:00', 10),
      sim('2026-07-02 12:00:00', 12, 'test'),
      m({ env: undefined as unknown as string, value: 5 }), // legacy row
    ]);
    expect(production).toHaveLength(2);
    expect(s).toHaveLength(1);
  });
});

describe('gapSpan', () => {
  it('prefers target↔baseline, falls back to target then prod, degenerates to null', () => {
    expect(gapSpan(70, 50, 60)).toBe(20);
    expect(gapSpan(70, null, 60)).toBe(70);
    expect(gapSpan(0, null, 60)).toBe(60);
    expect(gapSpan(0, 0, 0)).toBeNull();
  });
});

describe('computeConvergence', () => {
  it('is insufficient without both channels', () => {
    expect(computeConvergence([prod('2026-07-01 12:00:00', 10)], 20, 0).verdict).toBe('insufficient');
    expect(computeConvergence([sim('2026-07-01 12:00:00', 10)], 20, 0).verdict).toBe('insufficient');
    expect(computeConvergence([sim('2026-07-01 12:00:00', 10)], 20, 0).latest).toBeNull();
  });

  it('pairs each sim point with the nearest production point and flags staleness', () => {
    const conv = computeConvergence(
      [prod('2026-06-11 12:00:00', 51.93), sim('2026-07-23 12:00:00', 65.79)],
      70,
      51.93,
    );
    expect(conv.gaps).toHaveLength(1);
    const g = conv.gaps[0]!;
    expect(g.prodValue).toBe(51.93);
    expect(g.gap).toBeCloseTo(13.86, 2);
    expect(g.normalized).toBeCloseTo(13.86 / (70 - 51.93), 2);
    expect(g.prodStaleDays).toBe(42);
    expect(conv.verdict).toBe('insufficient'); // one sim run = no direction yet
  });

  it('reads converging when successive sim runs close the normalized gap', () => {
    const conv = computeConvergence(
      [
        prod('2026-07-01 12:00:00', 50),
        sim('2026-07-02 12:00:00', 70), // |gap| 20 / span 50 = 0.4
        prod('2026-07-10 12:00:00', 60),
        sim('2026-07-11 12:00:00', 62), // |gap| 2 / span 50 = 0.04
      ],
      100,
      50,
    );
    expect(conv.verdict).toBe('converging');
    expect(conv.latest?.prodValue).toBe(60);
  });

  it('reads diverging when the gap widens, stable when within epsilon', () => {
    const widen = computeConvergence(
      [prod('2026-07-01 12:00:00', 50), sim('2026-07-02 12:00:00', 52), sim('2026-07-11 12:00:00', 80)],
      100,
      50,
    );
    expect(widen.verdict).toBe('diverging');

    const flat = computeConvergence(
      [prod('2026-07-01 12:00:00', 50), sim('2026-07-02 12:00:00', 60), sim('2026-07-11 12:00:00', 60.5)],
      100,
      50,
    );
    expect(flat.verdict).toBe('stable');
  });

  it('never invents a normalized share on a degenerate span', () => {
    const conv = computeConvergence(
      [prod('2026-07-01 12:00:00', 0), sim('2026-07-02 12:00:00', 3)],
      0,
      0,
    );
    expect(conv.latest?.gap).toBe(3);
    expect(conv.latest?.normalized).toBeNull();
    expect(conv.verdict).toBe('insufficient');
  });
});
