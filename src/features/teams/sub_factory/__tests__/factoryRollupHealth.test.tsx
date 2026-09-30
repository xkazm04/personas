import { describe, it, expect } from 'vitest';
import { rollup, type MockKpi } from '../factoryModel';
// The matrix's own tone ramp, asserted directly so the `null` branch cannot
// be re-broken without this test failing.
import { healthMark, KPI_STATUS_MARK } from '../factoryTone';

function kpi(over: Partial<MockKpi>): MockKpi {
  return {
    id: 'k', name: 'K', category: 'technical', tier: 'primary', measureKind: 'manual',
    unit: '', direction: 'up', baseline: 0, current: null, target: 100,
    warnAt: 40, critAt: 20, cadence: 'manual', manualRating: null,
    ...over,
  } as MockKpi;
}


describe('rollup health for unmeasured KPIs', () => {
  it('all unmeasured: health is null, painted unmeasured, not crit', () => {
    const r = rollup([kpi({ id: 'a' }), kpi({ id: 'b', tier: 'north_star' })]);
    expect(r.unmeasured).toBe(2);
    expect(r.health).toBeNull();
    expect(healthMark(r.health)).toEqual(KPI_STATUS_MARK.unmeasured);
    expect(healthMark(r.health).tone).not.toBe(KPI_STATUS_MARK.crit.tone);
  });

  it('mixed: health is computed over the measured rows only', () => {
    // One met (score 1, weight 2) + one unmeasured (skipped) => 100.
    const r = rollup([kpi({ id: 'a', current: 100 }), kpi({ id: 'b' })]);
    expect(r.met).toBe(1);
    expect(r.unmeasured).toBe(1);
    expect(r.health).toBe(100);
    expect(healthMark(r.health).tone).toBe(KPI_STATUS_MARK.met.tone);
  });

  it('all met: health 100', () => {
    const r = rollup([kpi({ id: 'a', current: 100 }), kpi({ id: 'b', current: 120 })]);
    expect(r.health).toBe(100);
  });

  it('a measured failure still reads crit', () => {
    const r = rollup([kpi({ id: 'a', current: 5 })]);
    expect(r.crit).toBe(1);
    expect(r.health).toBe(0);
    expect(healthMark(r.health)).toEqual(KPI_STATUS_MARK.crit);
  });
});
