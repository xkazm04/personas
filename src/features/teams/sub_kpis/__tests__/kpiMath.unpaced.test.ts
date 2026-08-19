// The `unpaced` verdict — the honesty rule that a KPI goal derivation cannot
// even see must not be reported as "On track".
//
// The load-bearing invariant these tests protect is the mirror with
// `engine/kpi_derivation.rs::kpi_is_off_track`: splitting 'on-track' into
// 'on-track' | 'unpaced' must NOT move any KPI across the off-track boundary,
// because that boundary is what the Rust predicate (and therefore goal
// derivation) actually uses.
import { describe, it, expect } from 'vitest';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { kpiTrack } from '../kpiMath';
import { TRACK_COLOR } from '../kpiMeta';

function makeKpi(overrides: Partial<DevKpi>): DevKpi {
  return {
    id: 'k1',
    project_id: 'proj1',
    context_group_id: null,
    context_id: null,
    use_case_id: null,
    name: 'Some KPI',
    description: null,
    category: 'technical',
    measure_kind: 'manual',
    measure_config: '{}',
    unit: '',
    direction: 'up',
    baseline_value: 0,
    target_value: 100,
    target_date: null,
    current_value: 50,
    last_measured_at: null,
    cadence: 'manual',
    status: 'active',
    created_by: 'user',
    rationale: null,
    needed_connector: null,
    metric_type: null,
    tier: 'primary',
    warn_at: null,
    crit_at: null,
    manual_rating: null,
    assessment_pros: null,
    assessment_cons: null,
    last_skip_at: null,
    last_skip_rationale: null,
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-07-01 00:00:00',
    ...overrides,
  };
}

describe('kpiTrack — unpaced', () => {
  it('is unpaced when measured against a target but with no target_date', () => {
    // Mirrors kpi_derivation.rs:75 bailing out — derivation can never fire.
    expect(kpiTrack(makeKpi({ target_date: null }))).toBe('unpaced');
  });

  it('is unpaced when there is no target at all', () => {
    // Mirrors kpi_derivation.rs:58 bailing out.
    expect(kpiTrack(makeKpi({ target_value: null }))).toBe('unpaced');
  });

  it('is unpaced when a target_date exists but no baseline to pace from', () => {
    expect(kpiTrack(makeKpi({ target_date: '2026-12-01', baseline_value: null }))).toBe('unpaced');
  });

  it('is on-track (not unpaced) when a critical line is drawn and clear', () => {
    // crit_at IS a real evaluated verdict even without pace math.
    expect(kpiTrack(makeKpi({ target_date: null, crit_at: 10 }))).toBe('on-track');
  });

  it('is on-track when real pace math runs and the KPI is ahead', () => {
    expect(
      kpiTrack(makeKpi({ target_date: '2099-01-01', baseline_value: 0, current_value: 99 })),
    ).toBe('on-track');
  });

  it('still reports unmeasured ahead of unpaced', () => {
    expect(kpiTrack(makeKpi({ current_value: null, target_value: null }))).toBe('unmeasured');
  });

  it('still reports met, floor and crit breaches as before', () => {
    expect(kpiTrack(makeKpi({ current_value: 100 }))).toBe('met');
    expect(
      kpiTrack(makeKpi({ category: 'value', current_value: 0, target_value: null })),
    ).toBe('off-track');
    expect(kpiTrack(makeKpi({ crit_at: 60 }))).toBe('off-track');
  });

  it('never moves a KPI across the off-track boundary the Rust predicate uses', () => {
    // Every shape that reaches 'unpaced' must be NOT off-track, since
    // kpi_is_off_track returns false for all of them.
    const unpacedShapes: Array<Partial<DevKpi>> = [
      { target_date: null },
      { target_value: null },
      { target_date: '2026-12-01', baseline_value: null },
    ];
    for (const shape of unpacedShapes) {
      expect(kpiTrack(makeKpi(shape))).not.toBe('off-track');
    }
  });

  it('has a color and does not borrow the on-track tone', () => {
    expect(TRACK_COLOR.unpaced).toBeTruthy();
    expect(TRACK_COLOR.unpaced).not.toBe(TRACK_COLOR['on-track']);
    expect(TRACK_COLOR.unpaced).toBe(TRACK_COLOR.unmeasured);
  });
});
