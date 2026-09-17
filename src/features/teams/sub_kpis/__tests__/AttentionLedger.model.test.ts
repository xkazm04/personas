import { describe, it, expect } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevProject } from '@/lib/bindings/DevProject';
import { buildOverview } from '../kpiOverviewModel';
import { measuredAtMs } from '../kpiSample';
import {
  LEDGER_ID_CAP,
  ledgerKpiIds,
  realPoints,
  sparkPoints,
  sparkPolyline,
  sparkValues,
  stateChanges,
} from '../variants/AttentionLedger.model';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);

function kpi(over: Partial<DevKpi>): DevKpi {
  return {
    id: 'k', project_id: 'p1', context_group_id: null, context_id: null, use_case_id: null,
    name: 'k', description: '', category: 'quality', tier: 'supporting', measure_kind: 'manual',
    cadence: 'manual', status: 'active', created_by: 'user', metric_type: null, needed_connector: null,
    measure_config: '{}', unit: '', direction: 'up', baseline_value: 0, target_value: 100,
    target_date: null, current_value: null, last_measured_at: null, warn_at: null, crit_at: null,
    manual_rating: null, assessment_pros: null, assessment_cons: null, last_skip_at: null,
    last_skip_rationale: null, rationale: null, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    ...over,
  } as DevKpi;
}
function m(kpi_id: string, day: number, value: number, over: Partial<DevKpiMeasurement> = {}): DevKpiMeasurement {
  return {
    id: `${kpi_id}-${day}`, kpi_id, value,
    measured_at: new Date(T0 + day * DAY).toISOString().replace('T', ' ').slice(0, 19),
    source: 'scan', env: 'production', evidence: null, note: null, ...over,
  };
}
const projects = [{ id: 'p1', name: 'Alpha' }] as DevProject[];
const groups = [{ id: 'g1', project_id: 'p1', name: 'Core', color: '#000', domain: 'feature' }] as DevContextGroup[];

describe('ledgerKpiIds', () => {
  it('takes only KPIs that have a reading, in project → group order', () => {
    const ov = buildOverview(
      [kpi({ id: 'a', context_group_id: 'g1', current_value: 10 }), kpi({ id: 'b' })],
      projects, groups, 'Ungrouped',
    );
    expect(ledgerKpiIds(ov)).toEqual(['a']);
  });
  it('is bounded by the cap so one overview cannot fan out unbounded', () => {
    const many = Array.from({ length: 12 }, (_, i) => kpi({ id: `k${i}`, current_value: 1 }));
    const ov = buildOverview(many, projects, groups, 'Ungrouped');
    expect(ledgerKpiIds(ov, 5)).toHaveLength(5);
    expect(LEDGER_ID_CAP).toBe(400);
  });
});

describe('realPoints', () => {
  it('keeps production observations only, newest first', () => {
    const pts = realPoints([
      m('a', 0, 1),
      m('a', 5, 2),
      m('a', 6, 99, { source: 'simulation', env: 'local' }),
      m('a', 7, 50, { source: 'ai-compose' }),
      m('a', 8, 7, { env: 'test' }),
    ]);
    expect(pts.map((p) => p.value)).toEqual([2, 1]);
  });
  it('is empty for an unknown id', () => {
    expect(realPoints(undefined)).toEqual([]);
  });
});

describe('stateChanges', () => {
  const ov = (kpis: DevKpi[]) => buildOverview(kpis, projects, groups, 'Ungrouped')[0]!;

  it('reports a KPI whose newest reading flips the verdict, and nothing when it does not', () => {
    const k = kpi({ id: 'a', current_value: 40, crit_at: 50 });
    const changed = stateChanges(ov([k]), { a: [m('a', 0, 80), m('a', 3, 40)] });
    expect(changed).toHaveLength(1);
    expect(changed[0]!.from).toBe('on-track');
    expect(changed[0]!.to).toBe('off-track');
    expect(changed[0]!.at).toBe(measuredAtMs(m('a', 3, 40)));

    expect(stateChanges(ov([k]), { a: [m('a', 0, 80), m('a', 3, 80)] })).toEqual([]);
  });

  it('skips a KPI with fewer than two REAL readings (never calls it stable)', () => {
    const k = kpi({ id: 'a', current_value: 40, crit_at: 50 });
    expect(stateChanges(ov([k]), { a: [m('a', 3, 40)] })).toEqual([]);
    expect(stateChanges(ov([k]), { a: [m('a', 0, 80, { source: 'simulation', env: 'local' }), m('a', 3, 40)] })).toEqual([]);
  });

  it('puts off-track arrivals first, then most recent, and honors the limit', () => {
    const a = kpi({ id: 'a', current_value: 40, crit_at: 50 });   // → off-track
    const b = kpi({ id: 'b', current_value: 100 });               // → met
    const rows = stateChanges(ov([a, b]), {
      a: [m('a', 0, 80), m('a', 1, 40)],
      b: [m('b', 0, 10), m('b', 9, 100)],
    });
    expect(rows.map((r) => r.kpi.id)).toEqual(['a', 'b']);
    expect(rows[1]!.to).toBe('met');
    expect(stateChanges(ov([a, b]), { a: [m('a', 0, 80), m('a', 1, 40)], b: [m('b', 0, 10), m('b', 9, 100)] }, 1))
      .toHaveLength(1);
  });
});

describe('sparkValues', () => {
  const k = kpi({ id: 'a', baseline_value: 0, target_value: 100 });
  it('normalizes onto the % -of-target axis over the shared window', () => {
    const vals = sparkValues(k, [m('a', 0, 10), m('a', 10, 50)], { from: T0 - DAY, to: T0 + 11 * DAY }, 2);
    expect(vals).toEqual([10, 50]);
  });
  it('drops simulated/composed points and returns nothing for a simulated-only series', () => {
    expect(sparkValues(k, [m('a', 0, 10, { source: 'simulation', env: 'local' })], null)).toEqual([]);
    expect(sparkValues(k, [], null)).toEqual([]);
  });
  it('returns nothing when the KPI has no target to normalize against', () => {
    expect(sparkValues(kpi({ id: 'a', target_value: null }), [m('a', 0, 10)], null)).toEqual([]);
  });
});

describe('sparkPoints / sparkPolyline', () => {
  it('maps onto the FIXED domain, so equal values land at equal heights', () => {
    const a = sparkPoints([50, 50]);
    expect(a[0]!.y).toBe(a[1]!.y);
    expect(sparkPoints([-15])[0]!.y).toBe(22);   // domain floor → bottom
    expect(sparkPoints([115])[0]!.y).toBe(2);    // domain ceiling → top
  });
  it('centers a single point and spans the full width otherwise', () => {
    expect(sparkPoints([0]).map((p) => p.x)).toEqual([48]);
    expect(sparkPoints([0, 50, 100]).map((p) => p.x)).toEqual([0, 48, 96]);
    expect(sparkPolyline([0, 50, 100]).split(' ')).toHaveLength(3);
  });
});
