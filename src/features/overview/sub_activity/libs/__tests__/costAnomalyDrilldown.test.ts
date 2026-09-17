import { describe, it, expect } from 'vitest';
import { costAnomalyToMetricAnomaly } from '../executionMetricsHelpers';

// The Activity wall listed cost spikes and offered no way to explain one:
// `get_anomaly_drilldown` was reachable only from the Observability tab. The
// two surfaces measure the same spike on different scales, so the adapter is
// where sigma becomes percent-over-baseline — the shape the drilldown takes.
describe('costAnomalyToMetricAnomaly', () => {
  it('maps a cost spike onto the drilldown contract', () => {
    const anomaly = { date: '2026-09-15', cost: 42, moving_avg: 10.5 };
    expect(costAnomalyToMetricAnomaly(anomaly)).toEqual({
      date: '2026-09-15',
      metric: 'cost',
      value: 42,
      baseline: 10.5,
      deviation_pct: 300,
      execution_id: null,
    });
  });

  it('reports 0 rather than Infinity when the baseline is zero', () => {
    // A first-ever spend day has no percentage over baseline to report. The
    // absolute value still travels, so the drilldown is not left guessing.
    const r = costAnomalyToMetricAnomaly({ date: '2026-09-15', cost: 7, moving_avg: 0 });
    expect(r.deviation_pct).toBe(0);
    expect(r.value).toBe(7);
    expect(Number.isFinite(r.deviation_pct)).toBe(true);
  });

  it('never invents an execution attribution', () => {
    // The dashboard anomaly carries a LIST of costliest executions; the
    // drilldown contract has room for one, and picking a member of the list
    // would assert a cause the row does not claim.
    expect(costAnomalyToMetricAnomaly({ date: '2026-09-15', cost: 1, moving_avg: 1 }).execution_id).toBeNull();
  });
});
