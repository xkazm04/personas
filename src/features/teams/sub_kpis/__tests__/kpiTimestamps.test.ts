// @vitest-environment node
// KPI rows are written with SQLite `datetime('now')`: UTC, no zone marker.
// Read as local time they land hours off for every viewer outside UTC.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

import { kpiInstantMs } from '../kpiMath';
import { measuredAtMs } from '../kpiSample';
import { lastReadAt } from '../estate/kpiEstate';
import { computeConvergence } from '../kpiConvergence';

const prevTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { process.env.TZ = prevTz; });

const AT = '2026-09-21 10:00:00';
const AT_MS = Date.UTC(2026, 8, 21, 10, 0, 0);

describe('KPI timestamps are UTC', () => {
  it('reads a naive datetime as UTC whatever the viewer zone', () => {
    expect(new Date(2026, 8, 21).getTimezoneOffset()).toBe(240); // the zone really is UTC-4
    expect(kpiInstantMs(AT)).toBe(AT_MS);
    expect(kpiInstantMs('2026-09-21T10:00:00+00:00')).toBe(AT_MS);
    expect(kpiInstantMs('2026-12-31')).toBe(Date.UTC(2026, 11, 31));
    expect(Number.isNaN(kpiInstantMs('not a date'))).toBe(true);
  });

  it('every KPI model parses through it', () => {
    const m = { id: 'm', kpi_id: 'k', value: 1, measured_at: AT, source: 'manual', env: 'production', evidence: null, note: null } as DevKpiMeasurement;
    expect(measuredAtMs(m)).toBe(AT_MS);
    expect(lastReadAt({ last_measured_at: AT } as DevKpi)).toBe(AT_MS);
    const sim = { ...m, id: 's', measured_at: '2026-09-21 12:00:00', env: 'local', source: 'simulation' };
    const conv = computeConvergence([m, sim], 10, 0);
    expect(conv.latest?.prodAt).toBe(AT_MS);
  });
});
