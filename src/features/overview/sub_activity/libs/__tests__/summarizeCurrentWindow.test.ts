import { describe, it, expect } from 'vitest';
import { summarizeCurrentWindow } from '../executionMetricsHelpers';
import type { ExecutionDashboardData } from '@/lib/bindings/ExecutionDashboardData';
import type { DashboardDailyPoint } from '@/lib/bindings/DashboardDailyPoint';

// With Compare on, the pipeline fetches 2 x the window and every summary field
// of the payload covers BOTH periods. The Metrics tiles read those fields
// straight, so switching Compare on doubled "Total cost" under a label naming
// one window.

const NOW = Date.parse('2026-10-19T12:00:00Z');

function point(date: string, cost: number, completed: number, failed: number): DashboardDailyPoint {
  return {
    date, total_cost: cost, total_executions: completed + failed, completed, failed,
    success_rate: completed / (completed + failed), p50_duration_ms: 0, p95_duration_ms: 0,
    p99_duration_ms: 0, total_tokens: 0, persona_costs: [],
  };
}

// A 7-day window fetched as 14 days, sparse: only four days had runs.
const DATA: ExecutionDashboardData = {
  daily_points: [
    point('2026-10-06', 4, 4, 0), // previous period
    point('2026-10-12', 6, 2, 2), // previous period (window starts 10-13)
    point('2026-10-13', 1, 1, 0),
    point('2026-10-19', 2, 1, 1),
  ],
  top_personas: [],
  cost_anomalies: [
    { date: '2026-10-06', cost: 4, moving_avg: 1, std_dev: 1, deviation_sigma: 3, execution_ids: [] },
    { date: '2026-10-19', cost: 2, moving_avg: 1, std_dev: 0.4, deviation_sigma: 2.5, execution_ids: [] },
  ],
  total_executions: 11,
  successful_executions: 8,
  failed_executions: 3,
  total_cost: 13,
  overall_success_rate: 8 / 11,
  avg_latency_ms: 900,
  active_personas: 2,
  projected_monthly_cost: null,
  burn_rate: null,
};

describe('summarizeCurrentWindow', () => {
  it('measures the selected window only when Compare doubles the fetch', () => {
    const s = summarizeCurrentWindow(DATA, 7, true, NOW);
    expect(s.totalCost).toBe(3);
    expect(s.totalExecutions).toBe(3);
    expect(s.successRatio).toBeCloseTo(2 / 3);
    expect(s.dailyPoints.map((p) => p.date)).toEqual(['2026-10-13', '2026-10-19']);
    expect(s.anomalies.map((a) => a.date)).toEqual(['2026-10-19']);
  });

  it('cuts by calendar date, not by the last N points of a sparse series', () => {
    // The last 7 points would be all four days; the window holds two of them.
    expect(summarizeCurrentWindow(DATA, 7, true, NOW).dailyPoints).toHaveLength(2);
  });

  it('withholds a latency it cannot measure for the cut instead of the 2x figure', () => {
    expect(summarizeCurrentWindow(DATA, 7, true, NOW).avgLatencyMs).toBeNull();
  });

  it('reports no success ratio for a window that decided no run', () => {
    const s = summarizeCurrentWindow(DATA, 1, true, Date.parse('2026-10-25T12:00:00Z'));
    expect(s.totalExecutions).toBe(0);
    expect(s.successRatio).toBeNull();
  });

  it('passes the payload through when Compare is off', () => {
    const s = summarizeCurrentWindow(DATA, 14, false, NOW);
    expect(s.totalCost).toBe(13);
    expect(s.successRatio).toBeCloseTo(8 / 11);
    expect(s.avgLatencyMs).toBe(900);
    expect(s.dailyPoints).toHaveLength(4);
  });
});
